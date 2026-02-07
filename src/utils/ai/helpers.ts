/**
 * Helper functions shared across AI service modules.
 */

import { sanitizeMarkdownToPlainText } from "../textSanitizer";
import type { AIResponse, AIResponseWithTools } from "./types";
import type { ToolCallRequest } from "../../types/tools";

export function buildTextChannels(content: string): { rawMarkdown: string; plainText: string } {
  const rawMarkdown = typeof content === "string" ? content : String(content ?? "");
  return {
    rawMarkdown,
    plainText: sanitizeMarkdownToPlainText(rawMarkdown),
  };
}

export function createAIResponse(content: string, thinking?: string): AIResponse {
  const channels = buildTextChannels(content);
  return {
    content: channels.rawMarkdown,
    rawMarkdown: channels.rawMarkdown,
    plainText: channels.plainText,
    thinking,
  };
}

export function createAIResponseWithTools(
  content: string,
  thinking: string | undefined,
  toolCalls?: ToolCallRequest[]
): AIResponseWithTools {
  return {
    ...createAIResponse(content, thinking),
    toolCalls,
  };
}

export function extractThinking(content: string, reasoningContent?: string): { content: string; thinking?: string } {
  let thinking = reasoningContent;
  let finalContent = content;
  if (!thinking && content) {
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      finalContent = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    }
  }
  return { content: finalContent, thinking };
}

export function safeParseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { _raw: raw };
  }
  return { _raw: raw };
}
