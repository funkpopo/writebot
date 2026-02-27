/**
 * Shared types for the AI service modules.
 */

export type StreamChunkMeta =
  | {
      kind: "tool_text";
      toolName?: string;
      toolCallId?: string;
    };

// 流式回调类型 - 支持思维过程/工具参数文本
export type StreamCallback = (
  chunk: string,
  done: boolean,
  isThinking?: boolean,
  meta?: StreamChunkMeta
) => void;

// AI 响应结果（保留原始 Markdown，并提供纯文本通道）
export interface AIResponse {
  /** 原始模型输出（Markdown） */
  content: string;
  rawMarkdown: string;
  plainText: string;
  thinking?: string;
}

export interface AIResponseWithTools extends AIResponse {
  toolCalls?: import("../../types/tools").ToolCallRequest[];
}

export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface AIRequestOptions {
  signal?: AbortSignal;
  structuredOutput?: StructuredOutputSchema;
  model?: string;
  temperature?: number;
}
