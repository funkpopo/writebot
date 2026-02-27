import { callAI, callAIWithToolsStream, type AIRequestOptions } from "../../../../utils/aiService";
import { ConversationManager } from "../../../../utils/conversationManager";
import type { ToolDefinition, ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { StreamCallback, StreamChunkMeta } from "../../../../utils/ai/types";
import { buildWriterDraftSystemPrompt, buildWriterSystemPrompt } from "./prompts";
import { buildSectionContext } from "./contextBuilder";
import type { ArticleOutline, OutlineSection, SectionWriteResult } from "./types";

/** Tools the writer is allowed to use. */
const WRITER_TOOL_NAMES = new Set([
  "get_document_text",
  "get_paragraphs",
  "get_paragraph_by_index",
  "get_document_structure",
  "search_document",
  "insert_text",
  "append_text",
  "insert_after_paragraph",
  "replace_selected_text",
  "select_paragraph",
]);

/** Max agentic loop iterations to prevent runaway. */
const MAX_TOOL_ROUNDS = 15;

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
  revisionFeedback?: string;
  memoryContext?: string;
  aiOptions?: AIRequestOptions;
}

export interface WriteSectionResult {
  assistantContent: string;
  thinking?: string;
}

export interface DraftSectionParams {
  outline: ArticleOutline;
  section: OutlineSection;
  sectionIndex: number;
  memoryContext?: string;
  isRunCancelled: () => boolean;
  aiOptions?: AIRequestOptions;
}

/**
 * Writer Agent with agentic loop:
 *   AI call → tool calls → execute tools → feed results back → AI call → repeat
 * Loops until the AI produces no tool calls or MAX_TOOL_ROUNDS is reached.
 */
export async function writeSection(params: WriteSectionParams): Promise<WriteSectionResult> {
  const {
    outline, section, sectionIndex, previousSections,
    allTools, onChunk, executeToolCalls, writtenContentSegments,
    isRunCancelled, revisionFeedback, memoryContext, aiOptions,
  } = params;

  const tools = allTools.filter((t) => WRITER_TOOL_NAMES.has(t.name));
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (isRunCancelled()) break;

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

    await callAIWithToolsStream(
      conversation.getMessages(),
      tools,
      systemPrompt,
      wrappedOnChunk,
      (toolCalls) => { roundToolCalls = toolCalls; },
      aiOptions,
    );

    totalAssistantContent += roundContent;
    totalThinking += roundThinking;

    if (roundToolCalls.length === 0) {
      // AI is done — no more tool calls
      conversation.addAssistantMessage(roundContent, undefined, roundThinking || undefined);
      break;
    }

    // Record assistant message with tool calls in conversation
    conversation.addAssistantMessage(roundContent, roundToolCalls, roundThinking || undefined);

    // Execute tools via the orchestrator callback (handles UI, dedup, retry)
    const toolResults = await executeToolCalls(roundToolCalls, writtenContentSegments);

    if (isRunCancelled()) break;

    // Feed tool results back into conversation for the next AI round
    for (const result of toolResults) {
      conversation.addToolResult(result);
    }
  }

  return {
    assistantContent: totalAssistantContent.trim(),
    thinking: totalThinking.trim() || undefined,
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

export async function draftSection(params: DraftSectionParams): Promise<string> {
  const {
    outline,
    section,
    sectionIndex,
    memoryContext,
    isRunCancelled,
    aiOptions,
  } = params;

  if (isRunCancelled()) return "";

  const systemPrompt = buildWriterDraftSystemPrompt(outline, section, sectionIndex);
  const userMessage = buildParallelDraftUserMessage(
    outline,
    section,
    sectionIndex,
    memoryContext,
  );
  const result = await callAI(userMessage, systemPrompt, aiOptions);
  return (result.rawMarkdown ?? result.content).trim();
}
