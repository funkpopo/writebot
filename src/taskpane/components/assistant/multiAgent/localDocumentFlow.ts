import type { ToolCallRequest } from "../../../../types/tools";
import { callAIStream, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt, renderPromptTemplate } from "../../../../utils/promptService";
import { sanitizeMarkdownToPlainText } from "../../../../utils/textSanitizer";
import {
  getDocumentIndex,
  getParagraphIndicesInSelection,
  getSelectedText,
  readDocumentRanges,
  readNearbyContext,
} from "../../../../utils/wordApi";
import {
  AgentHarnessError,
  buildAgentTraceSummary,
  type AgentHarnessRuntime,
} from "./agentHarness";
import {
  appendPipelineMetrics,
} from "./pipelineMetrics";
import type { PromptIntakeContract } from "./promptIntake";
import {
  createRunMetricsDraft,
  finalizeRunMetrics,
  type RunMetricsDraft,
} from "./runtimeTypes";
import type { OrchestratorCallbacks } from "./types";

export type LocalDocumentTaskKind = "revise_existing" | "summarize" | "continue_document" | "format";

const FORMAT_OPTIMIZE_SYSTEM = `你是一个专业的文档排版与结构优化助手。
要求：
1. 在不改变核心事实的前提下，优化段落划分、标题层级、列表与可读性
2. 可使用 Markdown 标题（#/##/###）、列表与必要的空行表达结构
3. 不要杜撰原文没有的关键信息
4. 直接输出优化后的正文，不要解释过程，不要加前后缀或代码围栏
5. 不要输出 emoji 表情符号或颜文字`;

const CONTINUE_SYSTEM = `你是一个专业的写作续写助手。
要求：
1. 根据给定上文与用户指令继续写作，保持语气、人称与术语一致
2. 只输出「新增续写内容」，不要重复上文
3. 直接输出可写入文档的正文，不要解释、标签、代码围栏或前后缀
4. 不要使用 Markdown 标题（除非用户明确要求）
5. 不要输出 emoji 表情符号或颜文字`;

const SUMMARIZE_FALLBACK = `你是一个专业的文本摘要助手。
要求：
1. 提取核心观点与关键信息
2. 摘要简洁准确
3. 直接输出摘要正文，不要多余解释
4. 不要输出 emoji 表情符号或颜文字`;

export function isLocalDocumentTask(contract: PromptIntakeContract): contract is PromptIntakeContract & {
  taskType: LocalDocumentTaskKind;
} {
  return (
    contract.taskType === "revise_existing"
    || contract.taskType === "summarize"
    || contract.taskType === "continue_document"
    || contract.taskType === "format"
  );
}

/** Kept for revise-only call sites / tests. */
export function isSelectionReviseTask(contract: PromptIntakeContract): boolean {
  return contract.taskType === "revise_existing"
    && (
      contract.documentDependency === "needs_selection"
      || contract.documentDependency === "needs_ranges"
      || contract.documentDependency === "none"
    );
}

function taskLabel(taskType: LocalDocumentTaskKind): string {
  switch (taskType) {
    case "revise_existing":
      return "选区改写";
    case "summarize":
      return "总结";
    case "continue_document":
      return "续写";
    case "format":
      return "排版优化";
    default:
      return "本地文档任务";
  }
}

function phaseMessage(taskType: LocalDocumentTaskKind): string {
  switch (taskType) {
    case "revise_existing":
      return "正在读取选区并改写...";
    case "summarize":
      return "正在总结内容...";
    case "continue_document":
      return "正在根据上文续写...";
    case "format":
      return "正在优化排版结构...";
    default:
      return "正在处理文档任务...";
  }
}

function completedMessage(taskType: LocalDocumentTaskKind): string {
  return `${taskLabel(taskType)}完成`;
}

function normalizeModelText(raw: string, options?: { keepMarkdown?: boolean }): string {
  let text = (raw || "").trim();
  if (!text) return "";
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
  if (options?.keepMarkdown) {
    text = text
      .replace(/^```(?:markdown|md|text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return text;
  }
  return sanitizeMarkdownToPlainText(text).trim();
}

function buildContractExtras(contract: PromptIntakeContract): string {
  const lines: string[] = [
    "",
    "本轮任务来自「智能需求」本地文档短路径：",
    `- 任务类型：${contract.taskType}`,
    `- 主要目标：${contract.primaryGoal || "按用户指令处理文档"}`,
  ];
  if (contract.hardConstraints.length > 0) {
    lines.push("- 必须遵守的约束：");
    for (const item of contract.hardConstraints) {
      lines.push(`  - ${item}`);
    }
  }
  if (contract.outputRequirements.language) {
    lines.push(`- 输出语言：${contract.outputRequirements.language}`);
  }
  if (contract.outputRequirements.length) {
    lines.push(`- 篇幅要求：${contract.outputRequirements.length}`);
  }
  if (contract.outputRequirements.format) {
    lines.push(`- 格式要求：${contract.outputRequirements.format}`);
  }
  if (contract.outputRequirements.structure) {
    lines.push(`- 结构要求：${contract.outputRequirements.structure}`);
  }
  return lines.join("\n");
}

function buildSystemPrompt(contract: PromptIntakeContract & { taskType: LocalDocumentTaskKind }): string {
  const extras = buildContractExtras(contract);
  switch (contract.taskType) {
    case "revise_existing": {
      const base = (getPrompt("polish") || "").trim()
        || "你是专业文本改写助手。直接输出改写后正文，不要解释。";
      return `${base}\n${extras}\n- 只改写给定原文，不要扩写成新文章。`;
    }
    case "summarize": {
      const base = (getPrompt("summarize") || "").trim() || SUMMARIZE_FALLBACK;
      return `${base}\n${extras}\n- 针对给定原文总结，不要编造原文没有的事实。`;
    }
    case "continue_document": {
      const styleHint = renderPromptTemplate(getPrompt("continue") || CONTINUE_SYSTEM, {
        style: "专业、连贯",
      });
      return `${CONTINUE_SYSTEM}\n${extras}\n（风格参考：${styleHint.slice(0, 180)}）\n- 只输出新增续写，不要重复上文。`;
    }
    case "format":
      return `${FORMAT_OPTIMIZE_SYSTEM}\n${extras}`;
    default:
      return extras;
  }
}

function buildUserMessage(
  contract: PromptIntakeContract,
  sourceLabel: string,
  sourceText: string,
): string {
  const actionHint =
    contract.taskType === "continue_document"
      ? "请只输出续写的新内容（不要重复上文）。"
      : contract.taskType === "summarize"
        ? "请直接输出摘要正文。"
        : contract.taskType === "format"
          ? "请直接输出排版优化后的正文（可用 Markdown 标题/列表）。"
          : "请直接输出改写后的正文。";

  return [
    "## 用户指令",
    contract.rawPrompt.trim(),
    "",
    "## 主要目标",
    contract.primaryGoal || "按用户指令处理文档",
    "",
    `## 源文本（${sourceLabel}）`,
    "<<<<SOURCE",
    sourceText,
    "SOURCE>>>>",
    "",
    actionHint,
  ].join("\n");
}

interface SourceContext {
  text: string;
  label: string;
  paragraphIndices: number[];
  sourceChars: number;
  /** True when Word currently has a non-empty selection (for replace vs insert). */
  hadLiveSelection: boolean;
}

function buildDocumentSampleIndices(paragraphCount: number, maxSamples: number): number[] {
  if (paragraphCount <= 0) return [];
  if (paragraphCount <= maxSamples) {
    return Array.from({ length: paragraphCount }, (_, i) => i);
  }
  const head = Math.ceil(maxSamples * 0.45);
  const tail = Math.ceil(maxSamples * 0.3);
  const midBudget = Math.max(0, maxSamples - head - tail);
  const indices = new Set<number>();
  for (let i = 0; i < head; i += 1) indices.add(i);
  const midStart = Math.floor((paragraphCount - midBudget) / 2);
  for (let i = 0; i < midBudget; i += 1) indices.add(Math.min(paragraphCount - 1, midStart + i));
  for (let i = 0; i < tail; i += 1) indices.add(paragraphCount - 1 - i);
  return Array.from(indices).filter((i) => i >= 0 && i < paragraphCount).sort((a, b) => a - b);
}

async function loadSourceContext(
  contract: PromptIntakeContract & { taskType: LocalDocumentTaskKind },
  harness: AgentHarnessRuntime,
  runMetrics: RunMetricsDraft,
  promptContractHash: string,
): Promise<SourceContext> {
  const selectedText = (await getSelectedText()).trim();
  const paragraphIndices = await getParagraphIndicesInSelection();
  const hadLiveSelection = selectedText.length > 0;

  if (contract.taskType === "continue_document") {
    if (selectedText) {
      runMetrics.rangeReadCount += 1;
      harness.recordEvent({
        kind: "document_range_read_completed",
        agentId: "writer",
        message: "Loaded selection as continue context",
        metadata: {
          selectedChars: selectedText.length,
          paragraphIndices: paragraphIndices.slice(0, 32),
          promptContractHash,
        },
      });
      return {
        text: selectedText,
        label: "当前选区（作为上文）",
        paragraphIndices,
        sourceChars: selectedText.length,
        hadLiveSelection: true,
      };
    }

    let anchorIndex = paragraphIndices[0];
    if (anchorIndex === undefined) {
      const index = await getDocumentIndex();
      runMetrics.documentIndexBuildCount += 1;
      if (index.paragraphCount <= 0) {
        throw new AgentHarnessError(
          "document_range_unresolved",
          "文档为空，无法续写。请先输入一些内容或选中上文后再试。",
          { agentId: "writer", details: { taskType: contract.taskType } },
        );
      }
      anchorIndex = Math.max(0, index.paragraphCount - 1);
    }

    const nearby = await readNearbyContext({
      paragraphIndex: anchorIndex,
      before: 8,
      after: 0,
    });
    runMetrics.rangeReadCount += 1;
    const text = nearby.map((range) => range.text).join("\n\n").trim();
    if (!text) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        "未能读取到可用于续写的上文。请选中一段上文，或将光标放在正文段落中再试。",
        { agentId: "writer", details: { taskType: contract.taskType, anchorIndex } },
      );
    }
    const indices = nearby.flatMap((range) =>
      (range.paragraphs || []).map((p) => p.index),
    );
    const fallbackIndices = indices.length > 0
      ? indices
      : [nearby[0]?.startParagraphIndex, nearby[0]?.endParagraphIndex].filter(
        (n): n is number => typeof n === "number",
      );

    harness.recordEvent({
      kind: "document_range_read_completed",
      agentId: "writer",
      message: "Loaded nearby context for continue",
      metadata: {
        anchorIndex,
        sourceChars: text.length,
        paragraphIndices: fallbackIndices.slice(0, 32),
        promptContractHash,
      },
    });
    return {
      text,
      label: `光标附近上文（锚点段落 ${anchorIndex}）`,
      paragraphIndices: fallbackIndices,
      sourceChars: text.length,
      hadLiveSelection: false,
    };
  }

  if (
    contract.taskType === "summarize"
    && contract.documentDependency === "needs_index"
    && !selectedText
  ) {
    const index = await getDocumentIndex();
    runMetrics.documentIndexBuildCount += 1;
    if (index.paragraphCount <= 0) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        "文档为空，无法生成总结。",
        { agentId: "writer", details: { taskType: contract.taskType } },
      );
    }

    const sampleIndices = buildDocumentSampleIndices(index.paragraphCount, 48);
    const ranges = await readDocumentRanges({
      paragraphIndices: sampleIndices,
      maxParagraphs: 48,
    });
    runMetrics.rangeReadCount += 1;
    const body = ranges.map((range) => range.text).join("\n\n").trim();
    const headingLines = (index.headings || [])
      .slice(0, 40)
      .map((h) => `${"#".repeat(Math.min(6, Math.max(1, h.level || 1)))} ${h.text}`)
      .join("\n");
    const text = [
      headingLines ? `## 文档标题结构\n${headingLines}` : "",
      body ? `## 正文抽样\n${body}` : "",
    ].filter(Boolean).join("\n\n").trim();

    if (!text) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        "未能抽取到可总结的文档内容。",
        { agentId: "writer", details: { taskType: contract.taskType } },
      );
    }

    harness.recordEvent({
      kind: "document_range_read_completed",
      agentId: "writer",
      message: "Loaded document samples for summarize",
      metadata: {
        paragraphCount: index.paragraphCount,
        sampleCount: sampleIndices.length,
        sourceChars: text.length,
        promptContractHash,
      },
    });

    return {
      text,
      label: "文档抽样（全文总结）",
      paragraphIndices: sampleIndices,
      sourceChars: text.length,
      hadLiveSelection: false,
    };
  }

  // revise / format / selection summarize require Word selection
  if (!selectedText) {
    const hint =
      contract.taskType === "summarize"
        ? "请先选中要总结的文本，或使用「总结这篇文章/全文」类指令。"
        : contract.taskType === "format"
          ? "请先选中要排版优化的文本，再发送指令（例如「优化排版」「调整格式」）。"
          : "请先在文档中选中要处理的内容，再发送指令。";
    throw new AgentHarnessError(
      "document_range_unresolved",
      `未检测到 Word 选区文本。${hint}`,
      {
        agentId: "writer",
        details: {
          taskType: contract.taskType,
          documentDependency: contract.documentDependency,
          paragraphIndexCount: paragraphIndices.length,
        },
      },
    );
  }

  runMetrics.rangeReadCount += 1;
  harness.recordEvent({
    kind: "document_range_read_completed",
    agentId: "writer",
    message: `Loaded Word selection for ${contract.taskType}`,
    metadata: {
      selectedChars: selectedText.length,
      paragraphIndices: paragraphIndices.slice(0, 32),
      paragraphCount: paragraphIndices.length,
      promptContractHash,
    },
  });

  return {
    text: selectedText,
    label: "当前 Word 选区",
    paragraphIndices,
    sourceChars: selectedText.length,
    hadLiveSelection,
  };
}

function buildWriteToolCalls(
  taskType: LocalDocumentTaskKind,
  outputText: string,
  paragraphIndices: number[],
  hadLiveSelection: boolean,
): ToolCallRequest[] {
  const idBase = `local_${taskType}_${Date.now().toString(36)}`;

  if (taskType === "continue_document") {
    if (paragraphIndices.length > 0) {
      const last = paragraphIndices[paragraphIndices.length - 1];
      return [{
        id: idBase,
        name: "insert_after_paragraph",
        arguments: {
          paragraphIndex: last,
          text: outputText.startsWith("\n") ? outputText : `\n${outputText}`,
        },
      }];
    }
    return [{
      id: idBase,
      name: "insert_text",
      arguments: { text: outputText, location: "cursor" },
    }];
  }

  if (taskType === "summarize" && !hadLiveSelection) {
    return [{
      id: idBase,
      name: "insert_text",
      arguments: { text: outputText, location: "cursor" },
    }];
  }

  return [{
    id: idBase,
    name: "replace_selected_text",
    arguments: {
      text: outputText,
      preserveFormat: taskType !== "format",
    },
  }];
}

export interface RunLocalDocumentFlowParams {
  runId: string;
  promptContract: PromptIntakeContract;
  promptContractHash: string;
  intakePath?: "rule" | "llm";
  intakeMs?: number;
  harness: AgentHarnessRuntime;
  callbacks: OrchestratorCallbacks;
  aiOptions?: AIRequestOptions;
}

/**
 * Short-circuit multi-agent path for local document tasks:
 * revise / summarize / continue / format — no outline planner.
 */
export async function runLocalDocumentFlow(params: RunLocalDocumentFlowParams): Promise<void> {
  const {
    runId,
    promptContract,
    promptContractHash,
    intakePath,
    intakeMs,
    harness,
    callbacks,
    aiOptions,
  } = params;

  if (!isLocalDocumentTask(promptContract)) {
    throw new AgentHarnessError(
      "prompt_contract_invalid",
      `不是可执行的本地文档任务：${promptContract.taskType}`,
      { details: { taskType: promptContract.taskType } },
    );
  }

  const taskType = promptContract.taskType;
  const label = taskLabel(taskType);
  const runMetrics = createRunMetricsDraft(1, runId, { intakePath, intakeMs });

  await harness.withAgentStep(
    "writer",
    `local_document.${taskType}`,
    async () => {
      harness.recordPhase("writing", phaseMessage(taskType));
      callbacks.onPhaseChange("writing", phaseMessage(taskType));

      if (callbacks.isRunCancelled()) {
        throw new AgentHarnessError("cancelled", `${label}已取消`);
      }

      const source = await loadSourceContext(
        promptContract,
        harness,
        runMetrics,
        promptContractHash,
      );

      callbacks.onSectionStart(0, 1, label);
      callbacks.onChunk?.("", false);

      const keepMarkdown = taskType === "format" || taskType === "summarize";
      const outputText = await harness.runModelStep({
        agentId: "writer",
        stepName: `local_document.${taskType}.generate`,
        outputContract: `${taskType} text`,
        callModel: async () => {
          const result = await callAIStream(
            buildUserMessage(promptContract, source.label, source.text),
            buildSystemPrompt(promptContract),
            callbacks.onChunk,
            aiOptions,
          );
          return (result.rawMarkdown ?? result.content).trim();
        },
        parse: (rawContent) => {
          const text = normalizeModelText(rawContent, { keepMarkdown });
          if (!text) {
            throw new Error(`模型未返回有效的${label}结果`);
          }
          return text;
        },
        metadata: {
          sourceChars: source.sourceChars,
          promptContractHash,
          taskType,
        },
      });

      if (callbacks.isRunCancelled()) {
        throw new AgentHarnessError("cancelled", `${label}已取消`);
      }

      const toolCalls = buildWriteToolCalls(
        taskType,
        outputText,
        source.paragraphIndices,
        source.hadLiveSelection,
      );
      callbacks.onToolCalls(toolCalls);
      const toolResults = await callbacks.executeToolCalls(toolCalls, [outputText]);

      runMetrics.toolCalls += toolResults.length;
      runMetrics.toolFailures += toolResults.filter((item) => !item.success).length;
      runMetrics.writeTransactionCount += toolResults.filter((item) => item.success).length;

      const failed = toolResults.filter((item) => !item.success);
      if (failed.length > 0) {
        throw new AgentHarnessError(
          "tool_batch_failed",
          `${label}写入失败：${failed.map((item) => item.error || item.name).join("；")}`,
          {
            agentId: "writer",
            details: {
              failedTools: failed.map((item) => ({
                id: item.id,
                name: item.name,
                error: item.error,
              })),
            },
          },
        );
      }

      callbacks.onSectionDone(0, 1, label);
      callbacks.onDocumentSnapshot(outputText, `${label}结果`);
      callbacks.addChatMessage(
        [
          `### ${completedMessage(taskType)}`,
          `- 目标：${promptContract.primaryGoal || label}`,
          `- 源文本约 ${source.sourceChars} 字 → 结果约 ${outputText.length} 字`,
          source.paragraphIndices.length > 0
            ? `- 参考段落：${source.paragraphIndices[0]}${source.paragraphIndices.length > 1 ? `–${source.paragraphIndices[source.paragraphIndices.length - 1]}` : ""}（${source.paragraphIndices.length} 段）`
            : `- 来源：${source.label}`,
        ].join("\n"),
        { uiOnly: true },
      );

      harness.completeRun();
      const finalizedMetrics = finalizeRunMetrics(runMetrics);
      appendPipelineMetrics(finalizedMetrics);
      callbacks.addChatMessage(
        buildAgentTraceSummary(harness.getTrace()),
        { uiOnly: true },
      );
      callbacks.onPhaseChange("completed", completedMessage(taskType));
    },
    {
      taskType,
      documentDependency: promptContract.documentDependency,
      promptContractHash,
    },
  );
}

/** Backward-compatible alias used by previous revise-only entry. */
export async function runSelectionReviseFlow(params: RunLocalDocumentFlowParams): Promise<void> {
  return runLocalDocumentFlow(params);
}
