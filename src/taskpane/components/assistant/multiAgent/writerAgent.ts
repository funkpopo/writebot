import { callAIStream, type AIRequestOptions } from "../../../../utils/aiService";
import type { ToolCallRequest } from "../../../../types/tools";
import {
  AgentHarnessError,
  type AgentHarnessRuntime,
} from "./agentHarness";
import {
  buildWriterDraftSystemPrompt,
} from "./prompts";
import type { ArticleOutline, OutlineSection } from "./types";

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

export interface DraftSectionParams {
  outline: ArticleOutline;
  section: OutlineSection;
  sectionIndex: number;
  memoryContext?: string;
  isRunCancelled: () => boolean;
  harness: AgentHarnessRuntime;
  aiOptions?: AIRequestOptions;
  onChunk?: (chunk: string, done: boolean, isThinking?: boolean) => void;
}

/**
 * Legacy tool-loop state machine kept for regression tests.
 * Production writing path is draftSection (no tools) + sectionWriteFlow commit.
 */
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

/** 主写作路径：无工具草稿，由 sectionWriteFlow 确定性写入 Word。 */
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
