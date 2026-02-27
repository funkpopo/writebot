/**
 * AI Service - main orchestration and re-exports.
 *
 * This module dispatches to the correct provider based on config.apiType
 * and exposes the public API functions (polishText, translateText, etc.).
 */

import { ToolDefinition, ToolCallRequest } from "../../types/tools";
import { ConversationMessage } from "../conversationManager";
import { getPrompt, renderPromptTemplate } from "../promptService";
import {
  getTranslationTargetLabel,
  normalizeTranslationTargetLanguage,
  type TranslationRequestOptions,
} from "../translationLanguages";

// Re-export types
export type {
  StreamChunkMeta,
  StreamCallback,
  AIResponse,
  AIResponseWithTools,
  StructuredOutputSchema,
  AIRequestOptions,
} from "./types";

// Re-export config
export { setAIConfig, getAIConfig, isAPIConfigured, getAIConfigValidationError } from "./config";
import { assertAIConfig, getConfigRef } from "./config";

// Re-export fetch utilities
export { LOCAL_PROXY_URL, useProxy, smartFetch, fetchWithProxy } from "./fetch";

// Re-export helpers
export {
  buildTextChannels,
  createAIResponse,
  createAIResponseWithTools,
  extractThinking,
  safeParseArguments,
} from "./helpers";

// Re-export streamToolText
export {
  TOOL_TEXT_STREAM_NAMES,
  TEXT_ARG_START_RE,
  streamToolTextFromArgs,
} from "./streamToolText";
export type { ToolTextStreamState } from "./streamToolText";

// Re-export toolContinuation
export {
  MAX_CONTINUATION_ROUNDS,
  getOrderedToolCallEntries,
  sortToolEntriesByOrder,
  assignMissingToolCallOrder,
  isCompleteToolJson,
  __toolCallContinuationInternals,
} from "./toolContinuation";
export type {
  OrderedOpenAIToolCallState,
  OrderedAnthropicToolCallState,
  StreamResult,
  AnthropicStreamResult,
} from "./toolContinuation";

// Re-export provider functions
export {
  buildOpenAIMessages,
  callOpenAI,
  callOpenAIWithTools,
  callOpenAIStream,
  callOpenAIWithToolsStream,
  callOpenAIWithToolsStreamWithContinuation,
  callOpenAIWithToolsStreamSingle,
} from "./providers/openai";

export {
  buildAnthropicMessages,
  callAnthropic,
  callAnthropicWithTools,
  callAnthropicStream,
  callAnthropicWithToolsStream,
  callAnthropicWithToolsStreamWithContinuation,
  callAnthropicWithToolsStreamSingle,
} from "./providers/anthropic";

export {
  buildGeminiContents,
  callGemini,
  callGeminiWithTools,
  callGeminiStream,
  callGeminiWithToolsStream,
} from "./providers/gemini";

// Import providers for dispatching
import { callOpenAI, callOpenAIStream, callOpenAIWithTools, callOpenAIWithToolsStreamWithContinuation } from "./providers/openai";
import { callAnthropic, callAnthropicStream, callAnthropicWithTools, callAnthropicWithToolsStreamWithContinuation } from "./providers/anthropic";
import { callGemini, callGeminiStream, callGeminiWithTools, callGeminiWithToolsStream } from "./providers/gemini";

import type { AIResponse, AIResponseWithTools, StreamCallback, AIRequestOptions } from "./types";

function buildTranslatePromptInput(
  text: string,
  options?: TranslationRequestOptions
): string {
  const targetLanguage = normalizeTranslationTargetLanguage(options?.targetLanguage);
  if (targetLanguage === "auto_opposite") {
    return text;
  }

  const targetLabel = getTranslationTargetLabel(targetLanguage);
  return [
    `目标语言：${targetLabel}`,
    "请将下列文本完整翻译为目标语言，并仅输出译文：",
    "<<<<TEXT",
    text,
    "TEXT>>>>",
  ].join("\n");
}

/**
 * 调用 AI API（根据配置的 API 类型选择对应格式）
 */
export async function callAI(
  prompt: string,
  systemPrompt?: string,
  options?: AIRequestOptions
): Promise<AIResponse> {
  // 如果没有配置 API 密钥，抛出错误
  assertAIConfig();
  const config = getConfigRef();

  switch (config.apiType) {
    case "openai":
      return callOpenAI(prompt, systemPrompt, options);
    case "anthropic":
      return callAnthropic(prompt, systemPrompt, options);
    case "gemini":
      return callGemini(prompt, systemPrompt, options);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 流式调用 AI API（根据配置的 API 类型选择对应格式）
 * 返回完整响应，内部使用流式请求
 */
async function callAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk?: StreamCallback,
  options?: AIRequestOptions
): Promise<AIResponse> {
  assertAIConfig();
  const config = getConfigRef();

  switch (config.apiType) {
    case "openai":
      return callOpenAIStream(prompt, systemPrompt, onChunk, options);
    case "anthropic":
      return callAnthropicStream(prompt, systemPrompt, onChunk, options);
    case "gemini":
      return callGeminiStream(prompt, systemPrompt, onChunk, options);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 调用 AI API（支持工具调用）
 */
export async function callAIWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string,
  options?: AIRequestOptions
): Promise<AIResponseWithTools> {
  assertAIConfig();
  const config = getConfigRef();

  switch (config.apiType) {
    case "openai":
      return callOpenAIWithTools(messages, tools, systemPrompt, options);
    case "anthropic":
      return callAnthropicWithTools(messages, tools, systemPrompt, options);
    case "gemini":
      return callGeminiWithTools(messages, tools, systemPrompt, options);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 流式调用 AI API（支持工具调用）
 * 支持截断后自动继续补全工具调用
 */
export async function callAIWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void,
  options?: AIRequestOptions
): Promise<void> {
  assertAIConfig();
  const config = getConfigRef();

  switch (config.apiType) {
    case "openai":
      return callOpenAIWithToolsStreamWithContinuation(
        messages,
        tools,
        systemPrompt,
        onChunk,
        onToolCall,
        options
      );
    case "anthropic":
      return callAnthropicWithToolsStreamWithContinuation(
        messages,
        tools,
        systemPrompt,
        onChunk,
        onToolCall,
        options
      );
    case "gemini":
      return callGeminiWithToolsStream(messages, tools, systemPrompt, onChunk, onToolCall, options);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

// ==================== Public API functions ====================

/**
 * 文本润色
 */
export async function polishText(text: string): Promise<AIResponse> {
  const systemPrompt = getPrompt("polish");
  return callAI(text, systemPrompt);
}

/**
 * 翻译文本（多语种）
 */
export async function translateText(
  text: string,
  options?: TranslationRequestOptions
): Promise<AIResponse> {
  const systemPrompt = getPrompt("translate");
  const prompt = buildTranslatePromptInput(text, options);
  return callAI(prompt, systemPrompt);
}

/**
 * 语法检查
 */
export async function checkGrammar(text: string): Promise<AIResponse> {
  const systemPrompt = getPrompt("grammar");
  return callAI(text, systemPrompt);
}

/**
 * 生成摘要
 */
export async function summarizeText(text: string): Promise<AIResponse> {
  const systemPrompt = getPrompt("summarize");
  return callAI(text, systemPrompt);
}

/**
 * 续写内容
 */
export async function continueWriting(text: string, style: string): Promise<AIResponse> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = renderPromptTemplate(getPrompt("continue"), { style: styleDesc });
  return callAI(text, systemPrompt);
}

/**
 * 生成内容
 */
export async function generateContent(prompt: string, style: string): Promise<AIResponse> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = renderPromptTemplate(getPrompt("generate"), { style: styleDesc });
  return callAI(prompt, systemPrompt);
}

// ==================== 流式版本 ====================

/**
 * 文本润色（流式）
 */
export async function polishTextStream(
  text: string,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const systemPrompt = getPrompt("polish");
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 翻译文本（流式）
 */
export async function translateTextStream(
  text: string,
  onChunk?: StreamCallback,
  options?: TranslationRequestOptions
): Promise<AIResponse> {
  const systemPrompt = getPrompt("translate");
  const prompt = buildTranslatePromptInput(text, options);
  return callAIStream(prompt, systemPrompt, onChunk);
}

/**
 * 语法检查（流式）
 */
export async function checkGrammarStream(
  text: string,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const systemPrompt = getPrompt("grammar");
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 生成摘要（流式）
 */
export async function summarizeTextStream(
  text: string,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const systemPrompt = getPrompt("summarize");
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 续写内容（流式）
 */
export async function continueWritingStream(
  text: string,
  style: string,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = renderPromptTemplate(getPrompt("continue"), { style: styleDesc });
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 生成内容（流式）
 */
export async function generateContentStream(
  prompt: string,
  style: string,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = renderPromptTemplate(getPrompt("generate"), { style: styleDesc });
  return callAIStream(prompt, systemPrompt, onChunk);
}
