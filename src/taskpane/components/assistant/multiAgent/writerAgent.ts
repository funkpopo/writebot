import { callAIStream, callAIWithToolsStream, type AIRequestOptions } from "../../../../utils/aiService";
import { ConversationManager } from "../../../../utils/conversationManager";
import type { ToolDefinition, ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { StreamCallback, StreamChunkMeta } from "../../../../utils/ai/types";
import {
  AgentHarnessError,
  getAllowedToolNames,
  type AgentHarnessRuntime,
} from "./agentHarness";
import {
  buildWriterDraftSystemPrompt,
  buildWriterRevisionDraftSystemPrompt,
  buildWriterSystemPrompt,
} from "./prompts";
import { buildSectionContext } from "./contextBuilder";
import type { ArticleOutline, OutlineSection, SectionWriteResult } from "./types";

const MAX_TOOL_ROUNDS = 3;
const READ_TOOL_NAMES = new Set([
  "get_document_index",
  "read_document_ranges",
  "read_nearby_context",
  "search_document",
]);
const WRITE_TOOL_NAMES = new Set([
  "insert_at_anchor",
  "replace_paragraph_range",
  "rewrite_paragraph",
  "delete_paragraph_range",
]);

export interface WriteSectionParams {
  outline: ArticleOutline;
  section: OutlineSection;
  sectionIndex: number;
  previousSections: SectionWriteResult[];
  allTools: ToolDefinition[];
  onChunk: StreamCallback;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  writtenContentSegments: string[];
  isRunCancelled: () => boolean;
  harness: AgentHarnessRuntime;
  revisionFeedback?: string;
  memoryContext?: string;
  aiOptions?: AIRequestOptions;
}

export interface WriteSectionResult {
  assistantContent: string;
  thinking?: string;
  toolResults: ToolCallResult[];
}

export interface DraftSectionParams {
  outline: ArticleOutline;
  section: OutlineSection;
  sectionIndex: number;
  memoryContext?: string;
  isRunCancelled: () => boolean;
  harness: AgentHarnessRuntime;
  aiOptions?: AIRequestOptions;
  onChunk?: StreamCallback;
}

export interface DraftRevisionSectionParams extends DraftSectionParams {
  currentSectionContent: string;
  revisionFeedback: string;
}

/**
 * Legacy guarded Writer loop kept for compatibility with direct tests and
 * future targeted tools. Main article generation and revision use no-tool
 * draft calls plus deterministic transactions in sectionWriteFlow/qualityGate.
 */
export async function writeSection(params: WriteSectionParams): Promise<WriteSectionResult> {
  const {
    outline, section, sectionIndex, previousSections,
    allTools, onChunk, executeToolCalls, writtenContentSegments,
    isRunCancelled, harness, revisionFeedback, memoryContext, aiOptions,
  } = params;

  return harness.withAgentStep(
    "writer",
    `writer.write_section.${section.id}`,
    async () => {
      if (isRunCancelled()) {
        throw new AgentHarnessError("cancelled", "写作已取消", { agentId: "writer" });
      }
      return writeSectionCore({
        outline,
        section,
        sectionIndex,
        previousSections,
        allTools,
        onChunk,
        executeToolCalls,
        writtenContentSegments,
        isRunCancelled,
        harness,
        revisionFeedback,
        memoryContext,
        aiOptions,
      });
    },
    {
      sectionId: section.id,
      sectionIndex,
      revision: Boolean(revisionFeedback?.trim()),
    },
  );
}

export function validateWriterToolStateMachineRound(params: {
  round: number;
  section: OutlineSection;
  toolCalls: ToolCallRequest[];
  completedWriteCount: number;
  roundContent: string;
}): "continue" | "complete" {
  const { round, section, toolCalls, completedWriteCount, roundContent } = params;

  if (round === 1) {
    if (toolCalls.length === 0) {
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Writer 第 1 轮必须读取 DocumentSession 索引或目标 range：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, round } },
      );
    }
    const invalid = toolCalls.find((call) => !READ_TOOL_NAMES.has(call.name));
    if (invalid) {
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Writer 第 1 轮只允许读取工具，收到 ${invalid.name}`,
        { agentId: "writer", details: { sectionId: section.id, round, toolName: invalid.name } },
      );
    }
    return "continue";
  }

  if (round === 2) {
    const writeCalls = toolCalls.filter((call) => WRITE_TOOL_NAMES.has(call.name));
    const invalid = toolCalls.find((call) => !WRITE_TOOL_NAMES.has(call.name));
    if (invalid) {
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Writer 第 2 轮只允许 1 个结构化写入 transaction，收到 ${invalid.name}`,
        { agentId: "writer", details: { sectionId: section.id, round, toolName: invalid.name } },
      );
    }
    if (writeCalls.length !== 1) {
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Writer 第 2 轮必须且只能提交 1 个结构化写入 transaction，实际 ${writeCalls.length} 个`,
        { agentId: "writer", details: { sectionId: section.id, round, writeCallCount: writeCalls.length } },
      );
    }
    return "continue";
  }

  if (round === 3) {
    if (toolCalls.length === 0) {
      if (completedWriteCount < 1) {
        throw new AgentHarnessError(
          "tool_contract_violation",
          `Writer 未完成结构化写入，不能以 assistant 文本结束：${section.title}`,
          {
            agentId: "writer",
            details: {
              sectionId: section.id,
              round,
              assistantContentChars: roundContent.trim().length,
            },
          },
        );
      }
      return "complete";
    }
    if (completedWriteCount < 1) {
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Writer 未完成结构化写入，不能进入第 3 轮校验：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, round } },
      );
    }
    const invalid = toolCalls.find((call) => !READ_TOOL_NAMES.has(call.name));
    if (invalid) {
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Writer 第 3 轮只允许校验 changed range，收到 ${invalid.name}`,
        { agentId: "writer", details: { sectionId: section.id, round, toolName: invalid.name } },
      );
    }
    return "complete";
  }

  throw new AgentHarnessError(
    "tool_contract_violation",
    `Writer 超出严格 3 轮工具状态机：${section.title}`,
    { agentId: "writer", details: { sectionId: section.id, maxToolRounds: MAX_TOOL_ROUNDS } },
  );
}

async function writeSectionCore(params: WriteSectionParams): Promise<WriteSectionResult> {
  const {
    outline, section, sectionIndex, previousSections,
    allTools, onChunk, executeToolCalls, writtenContentSegments,
    isRunCancelled, harness, revisionFeedback, memoryContext, aiOptions,
  } = params;

  const writerToolNames = getAllowedToolNames("writer");
  const tools = allTools.filter((t) => writerToolNames.has(t.name));
  const systemPrompt = buildWriterSystemPrompt(outline, section, sectionIndex, revisionFeedback);
  const userMessage = buildSectionContext(
    outline,
    section,
    previousSections,
    revisionFeedback,
    memoryContext,
  );

  const conversation = new ConversationManager();
  conversation.addUserMessage(userMessage);

  let totalAssistantContent = "";
  let totalThinking = "";
  const executedToolResults: ToolCallResult[] = [];
  let completedWithoutToolCalls = false;
  let completedWriteCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (isRunCancelled()) {
      throw new AgentHarnessError("cancelled", "写作已取消", { agentId: "writer" });
    }

    let roundToolCalls: ToolCallRequest[] = [];
    let roundContent = "";
    let roundThinking = "";

    const wrappedOnChunk: StreamCallback = (
      chunk: string,
      done: boolean,
      isThinking?: boolean,
      meta?: StreamChunkMeta,
    ) => {
      if (done || !chunk) return;
      if (isThinking) {
        roundThinking += chunk;
      } else if (!meta?.kind || meta.kind !== "tool_text") {
        roundContent += chunk;
      }
      onChunk(chunk, done, isThinking, meta);
    };

    const modelEvent = harness.recordEvent({
      kind: "model_call_started",
      agentId: "writer",
      message: `writer.write_section.round_${round + 1}`,
      metadata: {
        sectionId: section.id,
        sectionIndex,
        round: round + 1,
        toolCount: tools.length,
      },
    });
    try {
      await callAIWithToolsStream(
        conversation.getMessages(),
        tools,
        systemPrompt,
        wrappedOnChunk,
        (toolCalls) => { roundToolCalls = toolCalls; },
        aiOptions,
      );
      harness.completeEvent(modelEvent, {
        kind: "model_call_completed",
        metadata: {
          sectionId: section.id,
          sectionIndex,
          round: round + 1,
          outputChars: roundContent.length,
          toolCallCount: roundToolCalls.length,
        },
      });
    } catch (error) {
      harness.completeEvent(modelEvent, {
        kind: "model_call_failed",
        metadata: {
          sectionId: section.id,
          sectionIndex,
          round: round + 1,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new AgentHarnessError(
        "model_call_failed",
        `Writer 模型调用失败：${error instanceof Error ? error.message : String(error)}`,
        { agentId: "writer", cause: error, details: { sectionId: section.id, round: round + 1 } },
      );
    }

    totalAssistantContent += roundContent;
    totalThinking += roundThinking;

    const stateMachineAction = validateWriterToolStateMachineRound({
      round: round + 1,
      section,
      toolCalls: roundToolCalls,
      completedWriteCount,
      roundContent,
    });

    if (roundToolCalls.length === 0) {
      conversation.addAssistantMessage(roundContent, undefined, roundThinking || undefined);
      completedWithoutToolCalls = true;
      break;
    }

    // Record assistant message with tool calls in conversation
    conversation.addAssistantMessage(roundContent, roundToolCalls, roundThinking || undefined);

    // Execute tools via the orchestrator callback (handles UI, dedup, retry)
    const toolResults = await executeToolCalls(roundToolCalls, writtenContentSegments);
    executedToolResults.push(...toolResults);
    completedWriteCount += toolResults.filter((result) =>
      result.success && WRITE_TOOL_NAMES.has(result.name)
    ).length;

    if (isRunCancelled()) {
      throw new AgentHarnessError("cancelled", "写作已取消", { agentId: "writer" });
    }

    // Feed tool results back into conversation for the next AI round
    for (const result of toolResults) {
      conversation.addToolResult(result);
    }

    if (stateMachineAction === "complete") {
      completedWithoutToolCalls = true;
      break;
    }
  }

  if (!completedWithoutToolCalls) {
    throw new AgentHarnessError(
      "state_contract_violation",
      `Writer 达到严格 ${MAX_TOOL_ROUNDS} 轮状态机上限，未完成 read/write/verify 流程`,
      { agentId: "writer", details: { sectionId: section.id, maxToolRounds: MAX_TOOL_ROUNDS } },
    );
  }

  return {
    assistantContent: totalAssistantContent.trim(),
    thinking: totalThinking.trim() || undefined,
    toolResults: executedToolResults,
  };
}

function buildParallelDraftUserMessage(
  outline: ArticleOutline,
  section: OutlineSection,
  sectionIndex: number,
  memoryContext?: string,
): string {
  const previousSection = sectionIndex > 0 ? outline.sections[sectionIndex - 1] : null;
  const nextSection = sectionIndex + 1 < outline.sections.length ? outline.sections[sectionIndex + 1] : null;

  const parts: string[] = [
    "## 文章信息",
    `标题：${outline.title}`,
    `主题：${outline.theme}`,
    `目标读者：${outline.targetAudience}`,
    `风格：${outline.style}`,
    "",
    "## 当前章节",
    `章节序号：${sectionIndex + 1}/${outline.sections.length}`,
    `章节标题：${section.title}`,
    `章节描述：${section.description}`,
    `预估段落：${section.estimatedParagraphs}`,
  ];

  if (section.keyPoints.length > 0) {
    parts.push("关键要点：");
    for (const keyPoint of section.keyPoints) {
      parts.push(`- ${keyPoint}`);
    }
  }

  parts.push("");
  parts.push("## 相邻章节（用于连贯性）");
  parts.push(previousSection ? `上一章节：${previousSection.title}` : "上一章节：无（这是首章）");
  parts.push(nextSection ? `下一章节：${nextSection.title}` : "下一章节：无（这是末章）");

  if (memoryContext?.trim()) {
    parts.push("");
    parts.push("## 长期记忆检索");
    parts.push(memoryContext.trim());
    parts.push("");
    parts.push("请保持术语、角色设定和已确认事实与长期记忆一致。");
  }

  return parts.join("\n");
}

function buildRevisionDraftUserMessage(
  outline: ArticleOutline,
  section: OutlineSection,
  sectionIndex: number,
  currentSectionContent: string,
  revisionFeedback: string,
  memoryContext?: string,
): string {
  const parts: string[] = [
    "## 文章信息",
    `标题：${outline.title}`,
    `主题：${outline.theme}`,
    `目标读者：${outline.targetAudience}`,
    `风格：${outline.style}`,
    "",
    "## 当前章节",
    `章节序号：${sectionIndex + 1}/${outline.sections.length}`,
    `章节标题：${section.title}`,
    `章节描述：${section.description}`,
    `预估段落：${section.estimatedParagraphs}`,
  ];

  if (section.keyPoints.length > 0) {
    parts.push("关键要点：");
    for (const keyPoint of section.keyPoints) {
      parts.push(`- ${keyPoint}`);
    }
  }

  parts.push("");
  parts.push("## 目标章节 range 当前正文");
  parts.push(currentSectionContent.trim());
  parts.push("");
  parts.push("## 审阅反馈");
  parts.push(revisionFeedback.trim());

  if (memoryContext?.trim()) {
    parts.push("");
    parts.push("## 长期记忆检索");
    parts.push(memoryContext.trim());
  }

  parts.push("");
  parts.push("请只输出修订后的目标章节 Markdown 正文。");

  return parts.join("\n");
}

export async function draftRevisionSection(params: DraftRevisionSectionParams): Promise<string> {
  const {
    outline,
    section,
    sectionIndex,
    memoryContext,
    isRunCancelled,
    harness,
    aiOptions,
    onChunk,
    currentSectionContent,
    revisionFeedback,
  } = params;

  if (isRunCancelled()) {
    throw new AgentHarnessError("cancelled", "修订草稿生成已取消", { agentId: "writer" });
  }
  if (!currentSectionContent.trim()) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `修订草稿缺少目标章节 range 正文：${section.title}`,
      { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
    );
  }

  const systemPrompt = buildWriterRevisionDraftSystemPrompt(outline, section, sectionIndex);
  const userMessage = buildRevisionDraftUserMessage(
    outline,
    section,
    sectionIndex,
    currentSectionContent,
    revisionFeedback,
    memoryContext,
  );
  return harness.withAgentStep(
    "writer",
    `writer.draft_revision_section.${section.id}`,
    () => harness.runModelStep({
      agentId: "writer",
      stepName: "writer.draft_revision_section",
      callModel: async () => {
        const result = await callAIStream(userMessage, systemPrompt, onChunk, aiOptions);
        return (result.rawMarkdown ?? result.content).trim();
      },
      parse: (rawContent) => rawContent,
      metadata: {
        sectionId: section.id,
        sectionIndex,
        currentSectionChars: currentSectionContent.length,
        revisionFeedbackChars: revisionFeedback.length,
      },
    }),
  );
}

export async function draftSection(params: DraftSectionParams): Promise<string> {
  const {
    outline,
    section,
    sectionIndex,
    memoryContext,
    isRunCancelled,
    harness,
    aiOptions,
    onChunk,
  } = params;

  if (isRunCancelled()) {
    throw new AgentHarnessError("cancelled", "草稿生成已取消", { agentId: "writer" });
  }

  const systemPrompt = buildWriterDraftSystemPrompt(outline, section, sectionIndex);
  const userMessage = buildParallelDraftUserMessage(
    outline,
    section,
    sectionIndex,
    memoryContext,
  );
  return harness.withAgentStep(
    "writer",
    `writer.draft_section.${section.id}`,
    () => harness.runModelStep({
      agentId: "writer",
      stepName: "writer.draft_section",
      callModel: async () => {
        const result = await callAIStream(userMessage, systemPrompt, onChunk, aiOptions);
        return (result.rawMarkdown ?? result.content).trim();
      },
      parse: (rawContent) => rawContent,
      metadata: {
        sectionId: section.id,
        sectionIndex,
      },
    }),
  );
}
