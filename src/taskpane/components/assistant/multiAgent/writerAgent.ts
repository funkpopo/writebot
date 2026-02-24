import { callAIWithToolsStream } from "../../../../utils/aiService";
import { ConversationManager } from "../../../../utils/conversationManager";
import type { ToolDefinition, ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { StreamCallback, StreamChunkMeta } from "../../../../utils/ai/types";
import { buildWriterSystemPrompt } from "./prompts";
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
}

export interface WriteSectionResult {
  assistantContent: string;
  thinking?: string;
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
    isRunCancelled, revisionFeedback,
  } = params;

  const tools = allTools.filter((t) => WRITER_TOOL_NAMES.has(t.name));
  const systemPrompt = buildWriterSystemPrompt(outline, section, sectionIndex, revisionFeedback);
  const userMessage = buildSectionContext(outline, section, previousSections, revisionFeedback);

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