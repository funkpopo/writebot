/**
 * AI 服务接口
 * 支持 OpenAI、Anthropic 两种 API 格式
 * 支持流式输出
 */

import {
  AISettings,
  applyApiDefaults,
  getDefaultSettings,
  getApiDefaults,
  getAISettingsValidationError,
} from "./storageService";
import { ToolDefinition, ToolCallRequest } from "../types/tools";
import { ConversationMessage } from "./conversationManager";
import {
  toOpenAITools,
  parseOpenAIToolCalls,
  toAnthropicTools,
  parseAnthropicToolCalls,
  serializeToolResult,
} from "./toolApiAdapters";
import { getPrompt, renderPromptTemplate } from "./promptService";
import { sanitizeMarkdownToPlainText } from "./textSanitizer";
import { DEFAULT_MAX_OUTPUT_TOKENS, normalizeMaxOutputTokens } from "./tokenUtils";

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
  toolCalls?: ToolCallRequest[];
}

function buildTextChannels(content: string): { rawMarkdown: string; plainText: string } {
  const rawMarkdown = typeof content === "string" ? content : String(content ?? "");
  return {
    rawMarkdown,
    plainText: sanitizeMarkdownToPlainText(rawMarkdown),
  };
}

function createAIResponse(content: string, thinking?: string): AIResponse {
  const channels = buildTextChannels(content);
  return {
    content: channels.rawMarkdown,
    rawMarkdown: channels.rawMarkdown,
    plainText: channels.plainText,
    thinking,
  };
}

function createAIResponseWithTools(
  content: string,
  thinking: string | undefined,
  toolCalls?: ToolCallRequest[]
): AIResponseWithTools {
  return {
    ...createAIResponse(content, thinking),
    toolCalls,
  };
}

// 本地代理服务器地址
const LOCAL_PROXY_URL = "https://localhost:53000/api/proxy";

// 是否使用代理（当直接请求失败时自动启用）
let useProxy = false;

/**
 * 通过本地代理发送请求（解决 CORS 问题）
 */
async function fetchWithProxy(
  url: string,
  options: RequestInit
): Promise<Response> {
  const proxyUrl = `${LOCAL_PROXY_URL}?target=${encodeURIComponent(url)}`;
  return fetch(proxyUrl, options);
}

/**
 * 智能 fetch：先尝试直接请求，如果遇到 CORS 错误则使用代理
 */
async function smartFetch(
  url: string,
  options: RequestInit
): Promise<Response> {
  // 如果已知需要使用代理，直接使用代理
  if (useProxy) {
    try {
      return await fetchWithProxy(url, options);
    } catch (proxyError) {
      const errorMsg = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`API 请求失败（通过代理）: ${errorMsg}。请确保本地服务器正在运行。`);
    }
  }

  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    // 检查是否是 CORS 或网络错误
    if (error instanceof TypeError) {
      console.log("直接请求失败，尝试使用本地代理...");
      useProxy = true;
      try {
        return await fetchWithProxy(url, options);
      } catch (proxyError) {
        const errorMsg = proxyError instanceof Error ? proxyError.message : String(proxyError);
        throw new Error(
          `API 请求失败: 直接请求被阻止（可能是 CORS 限制），代理请求也失败: ${errorMsg}。` +
          `请确保本地服务器正在运行，或检查 API 端点是否正确。`
        );
      }
    }
    throw error;
  }
}

// 默认配置（需要用户配置实际的 API 密钥）
const defaultConfig: AISettings = getDefaultSettings();

let config: AISettings = { ...defaultConfig };

function getMaxOutputTokens(): number {
  // 用户如需更小的输出上限，可通过配置覆盖；否则统一使用默认值 65535。
  return normalizeMaxOutputTokens(config.maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

function assertAIConfig(): void {
  const error = getAISettingsValidationError(config);
  if (error) {
    throw new Error(error);
  }
}

function extractThinking(content: string, reasoningContent?: string): { content: string; thinking?: string } {
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

function safeParseArguments(raw: string | undefined): Record<string, unknown> {
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

// Some agent tool calls contain large text payloads inside JSON arguments (e.g. insert_text/append_text).
// When streaming tool calls, we want to surface the incremental "text" value to the UI without waiting for
// the full tool call to finish.
const TOOL_TEXT_STREAM_NAMES = new Set(["insert_text", "append_text", "replace_selected_text"]);
const TEXT_ARG_START_RE = /"text"\s*:\s*"/;

type ToolTextStreamState = {
  parsePos: number;
  pendingEscape: boolean;
  pendingUnicode: string | null; // collected hex digits (0-4) after a \u escape
  done: boolean;
};

function streamToolTextFromArgs(
  rawArgs: string,
  toolName: string | undefined,
  state: ToolTextStreamState | undefined,
  onDelta: (delta: string) => void
): ToolTextStreamState | undefined {
  if (!toolName || !TOOL_TEXT_STREAM_NAMES.has(toolName)) return state;

  let next = state;
  if (!next) {
    const match = TEXT_ARG_START_RE.exec(rawArgs);
    if (!match || match.index === undefined) {
      return state;
    }

    const start = match.index + match[0].length;
    next = {
      parsePos: start,
      pendingEscape: false,
      pendingUnicode: null,
      done: false,
    };
  }

  if (next.done) return next;

  let deltaOut = "";

  while (next.parsePos < rawArgs.length) {
    // Continue an unfinished \uXXXX sequence.
    if (next.pendingUnicode !== null) {
      while (next.parsePos < rawArgs.length && next.pendingUnicode.length < 4) {
        const h = rawArgs[next.parsePos];
        if (!/[0-9a-fA-F]/.test(h)) {
          // Invalid escape: best-effort drop the escape rather than polluting output.
          next.pendingUnicode = null;
          break;
        }
        next.pendingUnicode += h;
        next.parsePos += 1;
      }

      if (next.pendingUnicode !== null && next.pendingUnicode.length < 4) {
        // Need more bytes.
        break;
      }

      if (next.pendingUnicode !== null && next.pendingUnicode.length === 4) {
        const code = parseInt(next.pendingUnicode, 16);
        deltaOut += String.fromCharCode(code);
        next.pendingUnicode = null;
      }

      continue;
    }

    // Continue an unfinished escape (we already consumed the backslash).
    if (next.pendingEscape) {
      if (next.parsePos >= rawArgs.length) break;
      const esc = rawArgs[next.parsePos];
      next.parsePos += 1;
      next.pendingEscape = false;

      switch (esc) {
        case "\"":
          deltaOut += "\"";
          break;
        case "\\":
          deltaOut += "\\";
          break;
        case "/":
          deltaOut += "/";
          break;
        case "n":
          deltaOut += "\n";
          break;
        case "r":
          deltaOut += "\r";
          break;
        case "t":
          deltaOut += "\t";
          break;
        case "b":
          deltaOut += "\b";
          break;
        case "f":
          deltaOut += "\f";
          break;
        case "u":
          next.pendingUnicode = "";
          break;
        default:
          // Unknown escape: emit the raw char (best-effort).
          deltaOut += esc;
          break;
      }
      continue;
    }

    const ch = rawArgs[next.parsePos];
    next.parsePos += 1;

    // End of the "text" JSON string value.
    if (ch === "\"") {
      next.done = true;
      break;
    }

    if (ch === "\\") {
      next.pendingEscape = true;
      continue;
    }

    deltaOut += ch;
  }

  if (deltaOut) onDelta(deltaOut);
  return next;
}

function buildOpenAIMessages(
  messages: ConversationMessage[],
  systemPrompt?: string
): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  if (systemPrompt) {
    output.push({ role: "system", content: systemPrompt });
  }

  for (const message of messages) {
    if (message.role === "user") {
      output.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const assistant: Record<string, unknown> = {
        role: "assistant",
        content: message.content || "",
      };
      if (message.toolCalls && message.toolCalls.length > 0) {
        assistant.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        }));
      }
      output.push(assistant);
      continue;
    }

    if (message.role === "tool") {
      const results = message.toolResults || [];
      if (results.length > 0) {
        for (const result of results) {
          output.push({
            role: "tool",
            tool_call_id: result.id,
            content: result.success
              ? serializeToolResult(result.result)
              : serializeToolResult({ error: result.error || "Tool execution failed" }),
          });
        }
      } else {
        output.push({ role: "tool", content: message.content });
      }
    }
  }

  return output;
}

function buildAnthropicMessages(messages: ConversationMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "user") {
      output.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        blocks.push(
          ...message.toolCalls.map((call) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          }))
        );
      }
      output.push({ role: "assistant", content: blocks.length > 0 ? blocks : "" });
      continue;
    }

    if (message.role === "tool") {
      const results = message.toolResults || [];
      if (results.length > 0) {
        output.push({
          role: "user",
          content: results.map((result) => ({
            type: "tool_result",
            tool_use_id: result.id,
            is_error: !result.success,
            content: result.success
              ? serializeToolResult(result.result)
              : serializeToolResult({ error: result.error || "Tool execution failed" }),
          })),
        });
      } else {
        output.push({ role: "user", content: message.content });
      }
    }
  }

  return output;
}

/**
 * 设置 AI 配置
 */
export function setAIConfig(newConfig: Partial<AISettings>): void {
  const nextType = newConfig.apiType ?? config.apiType;
  const merged = { ...config, ...newConfig, apiType: nextType } as AISettings;

  if (newConfig.apiType && newConfig.apiType !== config.apiType) {
    const defaults = getApiDefaults(nextType);
    merged.apiEndpoint = newConfig.apiEndpoint?.trim()
      ? newConfig.apiEndpoint
      : defaults.apiEndpoint;
    merged.model = newConfig.model?.trim()
      ? newConfig.model
      : defaults.model;
  }

  merged.maxOutputTokens = normalizeMaxOutputTokens(merged.maxOutputTokens);
  config = applyApiDefaults(merged);
}

/**
 * 获取当前配置
 */
export function getAIConfig(): AISettings {
  return { ...config };
}

/**
 * 检查 API 是否已配置
 */
export function isAPIConfigured(): boolean {
  return !getAISettingsValidationError(config);
}

/**
 * 获取当前配置的校验错误信息
 */
export function getAIConfigValidationError(): string | null {
  return getAISettingsValidationError(config);
}

/**
 * 调用 AI API（根据配置的 API 类型选择对应格式）
 */
async function callAI(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  // 如果没有配置 API 密钥，抛出错误
  assertAIConfig();

  switch (config.apiType) {
    case "openai":
      return callOpenAI(prompt, systemPrompt);
    case "anthropic":
      return callAnthropic(prompt, systemPrompt);
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
  onChunk?: StreamCallback
): Promise<AIResponse> {
  assertAIConfig();

  switch (config.apiType) {
    case "openai":
      return callOpenAIStream(prompt, systemPrompt, onChunk);
    case "anthropic":
      return callAnthropicStream(prompt, systemPrompt, onChunk);
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
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  assertAIConfig();

  switch (config.apiType) {
    case "openai":
      return callOpenAIWithTools(messages, tools, systemPrompt);
    case "anthropic":
      return callAnthropicWithTools(messages, tools, systemPrompt);
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
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  assertAIConfig();

  switch (config.apiType) {
    case "openai":
      return callOpenAIWithToolsStreamWithContinuation(messages, tools, systemPrompt, onChunk, onToolCall);
    case "anthropic":
      return callAnthropicWithToolsStreamWithContinuation(messages, tools, systemPrompt, onChunk, onToolCall);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 调用 OpenAI API
 */
async function callOpenAI(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const reasoningContent = data.choices[0].message.reasoning_content;

  // 如果没有 reasoning_content，尝试从内容中提取 <think></think> 标签
  let thinking = reasoningContent;
  let finalContent = content;
  if (!thinking && content) {
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      finalContent = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    }
  }

  return createAIResponse(finalContent, thinking);
}

/**
 * 调用 Anthropic API
 */
async function callAnthropic(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  // Anthropic API 可能返回多个内容块，包括 thinking 和 text 类型
  let thinking = "";
  let content = "";
  for (const block of data.content) {
    if (block.type === "thinking") {
      thinking += block.thinking || "";
    } else if (block.type === "text") {
      content += block.text || "";
    }
  }
  return createAIResponse(content, thinking || undefined);
}

/**
 * 调用 OpenAI API（支持工具调用）
 */
async function callOpenAIWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const openAIMessages = buildOpenAIMessages(messages, systemPrompt);

  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      messages: openAIMessages,
      tools: toOpenAITools(tools),
      tool_choice: "auto",
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message || {};
  const content = message.content || "";
  const { content: finalContent, thinking } = extractThinking(
    content,
    message.reasoning_content
  );
  const toolCalls = parseOpenAIToolCalls(data);

  return createAIResponseWithTools(finalContent, thinking, toolCalls);
}

/**
 * 调用 Anthropic API（支持工具调用）
 */
async function callAnthropicWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: buildAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  let thinking = "";
  let content = "";
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === "thinking") {
        thinking += block.thinking || "";
      } else if (block.type === "text") {
        content += block.text || "";
      }
    }
  }

  const toolCalls = parseAnthropicToolCalls(data);

  return createAIResponseWithTools(content, thinking || undefined, toolCalls);
}

/**
 * 流式调用 OpenAI API
 * 支持 reasoning_content 字段和 <think></think> 标签格式的思维内容
 * 返回完整响应，内部使用流式请求
 */
async function callOpenAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let seenDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
        seenDone = true;
        break;
      }
      // 兼容 "data: " 和 "data:" 两种格式
      if (trimmed.startsWith("data:")) {
        try {
          const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
          const json = JSON.parse(jsonStr);
          const delta = json.choices?.[0]?.delta;
          // 检测 reasoning_content（思维过程）
          if (delta?.reasoning_content) {
            reasoning += delta.reasoning_content;
            onChunk?.(delta.reasoning_content, false, true);
          }
          // 正常内容
          if (delta?.content) {
            content += delta.content;
            onChunk?.(delta.content, false, false);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    if (seenDone) break;
  }

  if (seenDone) {
    // Some OpenAI-compatible gateways send [DONE] but keep the connection alive.
    // Treat [DONE] as the authoritative terminator.
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  } else if (buffer.trim().startsWith("data:")) {
    // Best-effort: process a final line if the stream ends without a trailing newline.
    const trimmed = buffer.trim();
    if (trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]") {
      try {
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        const json = JSON.parse(jsonStr);
        const delta = json.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
          onChunk?.(delta.reasoning_content, false, true);
        }
        if (delta?.content) {
          content += delta.content;
          onChunk?.(delta.content, false, false);
        }
      } catch {
        // ignore
      }
    }
  }

  onChunk?.("", true);

  // 处理 <think></think> 标签
  const extracted = extractThinking(content, reasoning || undefined);
  return createAIResponse(extracted.content, extracted.thinking);
}

/**
 * 流式调用 Anthropic API
 * 自动检测 extended thinking 的 thinking 内容块
 * 返回完整响应，内部使用流式请求
 */
async function callAnthropicStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType: "thinking" | "text" | null = null;
  let content = "";
  let thinking = "";
  let seenStop = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      // 兼容 "data: " 和 "data:" 两种格式
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      try {
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        const json = JSON.parse(jsonStr);
        if (json.type === "message_stop") {
          seenStop = true;
          break;
        }
        // 检测内容块开始，判断是 thinking 还是 text
        if (json.type === "content_block_start") {
          currentBlockType = json.content_block?.type === "thinking" ? "thinking" : "text";
        }
        // 内容块增量
        if (json.type === "content_block_delta") {
          const isThinking = currentBlockType === "thinking";
          // thinking 块使用 thinking 字段，text 块使用 text 字段
          const text = isThinking ? json.delta?.thinking : json.delta?.text;
          if (text) {
            if (isThinking) {
              thinking += text;
              onChunk?.(text, false, true);
            } else {
              content += text;
              onChunk?.(text, false, false);
            }
          }
        }
        // 内容块结束
        if (json.type === "content_block_stop") {
          currentBlockType = null;
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (seenStop) break;
  }

  if (seenStop) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  onChunk?.("", true);

  return createAIResponse(content, thinking || undefined);
}

/**
 * 流式调用 OpenAI API（支持工具调用）
 */
async function callOpenAIWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  const openAIMessages = buildOpenAIMessages(messages, systemPrompt);

  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      messages: openAIMessages,
      tools: toOpenAITools(tools),
      tool_choice: "auto",
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallMap: Record<
    number,
    { id?: string; name?: string; arguments: string; textStream?: ToolTextStreamState }
  > = {};
  let seenDone = false;

  const flushToolCalls = () => {
    const toolCalls: ToolCallRequest[] = Object.values(toolCallMap).map((entry, index) => ({
      id: entry.id || `${entry.name || "tool"}_${index}`,
      name: entry.name || "unknown",
      arguments: safeParseArguments(entry.arguments),
    }));
    if (toolCalls.length > 0) {
      onToolCall(toolCalls);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
        seenDone = true;
        break;
      }
      // 兼容 "data: " 和 "data:" 两种格式
      if (trimmed.startsWith("data:")) {
        try {
          const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
          const json = JSON.parse(jsonStr);
          const delta = json.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            onChunk(delta.reasoning_content, false, true);
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index ?? 0;
              if (!toolCallMap[index]) {
                toolCallMap[index] = { arguments: "" };
              }
              if (toolCall.id) toolCallMap[index].id = toolCall.id;
              if (toolCall.function?.name) toolCallMap[index].name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                toolCallMap[index].arguments += toolCall.function.arguments;
              }

              const entry = toolCallMap[index];
              entry.textStream = streamToolTextFromArgs(
                entry.arguments,
                entry.name,
                entry.textStream,
                (deltaText) => {
                  const stableId = entry.id || `${entry.name || "tool"}_${index}`;
                  onChunk(deltaText, false, false, {
                    kind: "tool_text",
                    toolName: entry.name,
                    toolCallId: stableId,
                  });
                }
              );
            }
          }

          // 正常内容 - 直接输出
          if (delta?.content) {
            onChunk(delta.content, false, false);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    if (seenDone) break;
  }

  if (seenDone) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  onChunk("", true);
  flushToolCalls();
}

/**
 * 流式调用 Anthropic API（支持工具调用）
 */
async function callAnthropicWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: buildAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType: "thinking" | "text" | "tool_use" | null = null;
  let currentToolIndex: number | null = null;
  const toolCallMap: Record<
    number,
    { id?: string; name?: string; inputJson: string; textStream?: ToolTextStreamState }
  > = {};
  let seenStop = false;

  const flushToolCalls = () => {
    const toolCalls: ToolCallRequest[] = Object.values(toolCallMap).map((entry, index) => ({
      id: entry.id || `${entry.name || "tool"}_${index}`,
      name: entry.name || "unknown",
      arguments: safeParseArguments(entry.inputJson),
    }));
    if (toolCalls.length > 0) {
      onToolCall(toolCalls);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      // 兼容 "data: " 和 "data:" 两种格式
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      try {
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        const json = JSON.parse(jsonStr);

        // Some proxies keep the connection open even after message_stop.
        if (json.type === "message_stop") {
          seenStop = true;
          break;
        }

        if (json.type === "content_block_start") {
          const blockType = json.content_block?.type;
          if (blockType === "tool_use") {
            currentBlockType = "tool_use";
            const toolIndex = json.index ?? Object.keys(toolCallMap).length;
            currentToolIndex = toolIndex;
            toolCallMap[toolIndex] = {
              id: json.content_block?.id,
              name: json.content_block?.name,
              inputJson: "",
            };
          } else if (blockType === "thinking") {
            currentBlockType = "thinking";
          } else {
            currentBlockType = "text";
          }
        }

        if (json.type === "content_block_delta") {
          if (currentBlockType === "thinking") {
            const text = json.delta?.thinking;
            if (text) {
              onChunk(text, false, true);
            }
          } else if (currentBlockType === "text") {
            const text = json.delta?.text;
            if (text) {
              onChunk(text, false, false);
            }
          } else if (currentBlockType === "tool_use" && currentToolIndex !== null) {
            const partial = json.delta?.partial_json;
            if (partial) {
              toolCallMap[currentToolIndex].inputJson += partial;

              const entry = toolCallMap[currentToolIndex];
              entry.textStream = streamToolTextFromArgs(
                entry.inputJson,
                entry.name,
                entry.textStream,
                (deltaText) => {
                  const stableId =
                    entry.id || `${entry.name || "tool"}_${String(currentToolIndex)}`;
                  onChunk(deltaText, false, false, {
                    kind: "tool_text",
                    toolName: entry.name,
                    toolCallId: stableId,
                  });
                }
              );
            }
          }
        }

        if (json.type === "content_block_stop") {
          currentBlockType = null;
          currentToolIndex = null;
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (seenStop) break;
  }

  if (seenStop) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  onChunk("", true);
  flushToolCalls();
}

/**
 * 文本润色
 */
export async function polishText(text: string): Promise<AIResponse> {
  const systemPrompt = getPrompt("polish");
  return callAI(text, systemPrompt);
}

/**
 * 翻译文本（中英互译）
 */
export async function translateText(text: string): Promise<AIResponse> {
  const systemPrompt = getPrompt("translate");
  return callAI(text, systemPrompt);
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
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const systemPrompt = getPrompt("translate");
  return callAIStream(text, systemPrompt, onChunk);
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

// ==================== 截断后继续补全支持 ====================

const MAX_CONTINUATION_ROUNDS = 3;

interface StreamResult {
  content: string;
  toolCallMap: Record<number, { id?: string; name?: string; arguments: string }>;
  finishReason: string | null;
}

/**
 * OpenAI 流式工具调用（支持截断后继续补全）
 */
async function callOpenAIWithToolsStreamWithContinuation(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  let currentMessages = [...messages];
  let accumulatedContent = "";
  let accumulatedToolCallMap: Record<number, { id?: string; name?: string; arguments: string }> = {};

  for (let round = 0; round < MAX_CONTINUATION_ROUNDS; round++) {
    const result = await callOpenAIWithToolsStreamSingle(
      currentMessages,
      tools,
      systemPrompt,
      onChunk,
      accumulatedToolCallMap
    );

    accumulatedContent += result.content;
    accumulatedToolCallMap = result.toolCallMap;

    // 如果不是因为长度限制而停止，或者没有工具调用，则结束
    if (result.finishReason !== "length" || Object.keys(accumulatedToolCallMap).length === 0) {
      // 输出最终的工具调用
      const toolCalls: ToolCallRequest[] = Object.values(accumulatedToolCallMap).map((entry, index) => ({
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "unknown",
        arguments: safeParseArguments(entry.arguments),
      }));
      if (toolCalls.length > 0) {
        onToolCall(toolCalls);
      }
      onChunk("", true);
      return;
    }

    // 检查工具调用参数是否完整（尝试解析 JSON）
    const hasIncompleteToolCall = Object.values(accumulatedToolCallMap).some((entry) => {
      if (!entry.arguments) return true;
      try {
        JSON.parse(entry.arguments);
        return false;
      } catch {
        return true;
      }
    });

    if (!hasIncompleteToolCall) {
      // 工具调用参数已完整，输出结果
      const toolCalls: ToolCallRequest[] = Object.values(accumulatedToolCallMap).map((entry, index) => ({
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "unknown",
        arguments: safeParseArguments(entry.arguments),
      }));
      if (toolCalls.length > 0) {
        onToolCall(toolCalls);
      }
      onChunk("", true);
      return;
    }

    // 构建继续请求的消息
    // 将当前的部分响应作为 assistant 消息添加到上下文中
    const partialAssistantMessage: ConversationMessage = {
      role: "assistant",
      content: accumulatedContent,
      toolCalls: Object.values(accumulatedToolCallMap).map((entry, index) => ({
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "unknown",
        arguments: safeParseArguments(entry.arguments),
      })),
    };

    // 添加一个用户消息请求继续
    currentMessages = [
      ...messages,
      partialAssistantMessage,
      { role: "user", content: "请继续完成上面的工具调用，直接输出剩余的 JSON 参数内容。" },
    ];
  }

  // 达到最大轮次，输出当前结果
  const toolCalls: ToolCallRequest[] = Object.values(accumulatedToolCallMap).map((entry, index) => ({
    id: entry.id || `${entry.name || "tool"}_${index}`,
    name: entry.name || "unknown",
    arguments: safeParseArguments(entry.arguments),
  }));
  if (toolCalls.length > 0) {
    onToolCall(toolCalls);
  }
  onChunk("", true);
}

/**
 * OpenAI 单次流式工具调用（内部函数）
 */
async function callOpenAIWithToolsStreamSingle(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  existingToolCallMap: Record<number, { id?: string; name?: string; arguments: string }>
): Promise<StreamResult> {
  const openAIMessages = buildOpenAIMessages(messages, systemPrompt);

  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      messages: openAIMessages,
      tools: toOpenAITools(tools),
      tool_choice: "auto",
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallMap: Record<number, { id?: string; name?: string; arguments: string; textStream?: ToolTextStreamState }> = {};

  // 复制已有的工具调用数据
  for (const [key, value] of Object.entries(existingToolCallMap)) {
    toolCallMap[Number(key)] = { ...value };
  }

  let seenDone = false;
  let finishReason: string | null = null;
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
        seenDone = true;
        break;
      }
      if (trimmed.startsWith("data:")) {
        try {
          const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
          const json = JSON.parse(jsonStr);
          const choice = json.choices?.[0];
          const delta = choice?.delta;

          // 捕获 finish_reason
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (delta?.reasoning_content) {
            onChunk(delta.reasoning_content, false, true);
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index ?? 0;
              if (!toolCallMap[index]) {
                toolCallMap[index] = { arguments: "" };
              }
              if (toolCall.id) toolCallMap[index].id = toolCall.id;
              if (toolCall.function?.name) toolCallMap[index].name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                toolCallMap[index].arguments += toolCall.function.arguments;
              }

              const entry = toolCallMap[index];
              entry.textStream = streamToolTextFromArgs(
                entry.arguments,
                entry.name,
                entry.textStream,
                (deltaText) => {
                  const stableId = entry.id || `${entry.name || "tool"}_${index}`;
                  onChunk(deltaText, false, false, {
                    kind: "tool_text",
                    toolName: entry.name,
                    toolCallId: stableId,
                  });
                }
              );
            }
          }

          if (delta?.content) {
            content += delta.content;
            onChunk(delta.content, false, false);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    if (seenDone) break;
  }

  if (seenDone) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  // 返回结果（不包含 textStream 状态）
  const cleanToolCallMap: Record<number, { id?: string; name?: string; arguments: string }> = {};
  for (const [key, value] of Object.entries(toolCallMap)) {
    cleanToolCallMap[Number(key)] = {
      id: value.id,
      name: value.name,
      arguments: value.arguments,
    };
  }

  return {
    content,
    toolCallMap: cleanToolCallMap,
    finishReason,
  };
}

/**
 * Anthropic 流式工具调用（支持截断后继续补全）
 */
async function callAnthropicWithToolsStreamWithContinuation(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  let currentMessages = [...messages];
  let accumulatedContent = "";
  let accumulatedToolCallMap: Record<number, { id?: string; name?: string; inputJson: string }> = {};

  for (let round = 0; round < MAX_CONTINUATION_ROUNDS; round++) {
    const result = await callAnthropicWithToolsStreamSingle(
      currentMessages,
      tools,
      systemPrompt,
      onChunk,
      accumulatedToolCallMap
    );

    accumulatedContent += result.content;
    accumulatedToolCallMap = result.toolCallMap;

    // 如果不是因为长度限制而停止，或者没有工具调用，则结束
    if (result.finishReason !== "max_tokens" || Object.keys(accumulatedToolCallMap).length === 0) {
      // 输出最终的工具调用
      const toolCalls: ToolCallRequest[] = Object.values(accumulatedToolCallMap).map((entry, index) => ({
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "unknown",
        arguments: safeParseArguments(entry.inputJson),
      }));
      if (toolCalls.length > 0) {
        onToolCall(toolCalls);
      }
      onChunk("", true);
      return;
    }

    // 检查工具调用参数是否完整
    const hasIncompleteToolCall = Object.values(accumulatedToolCallMap).some((entry) => {
      if (!entry.inputJson) return true;
      try {
        JSON.parse(entry.inputJson);
        return false;
      } catch {
        return true;
      }
    });

    if (!hasIncompleteToolCall) {
      // 工具调用参数已完整，输出结果
      const toolCalls: ToolCallRequest[] = Object.values(accumulatedToolCallMap).map((entry, index) => ({
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "unknown",
        arguments: safeParseArguments(entry.inputJson),
      }));
      if (toolCalls.length > 0) {
        onToolCall(toolCalls);
      }
      onChunk("", true);
      return;
    }

    // 构建继续请求的消息
    const partialAssistantMessage: ConversationMessage = {
      role: "assistant",
      content: accumulatedContent,
      toolCalls: Object.values(accumulatedToolCallMap).map((entry, index) => ({
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "unknown",
        arguments: safeParseArguments(entry.inputJson),
      })),
    };

    currentMessages = [
      ...messages,
      partialAssistantMessage,
      { role: "user", content: "请继续完成上面的工具调用，直接输出剩余的 JSON 参数内容。" },
    ];
  }

  // 达到最大轮次，输出当前结果
  const toolCalls: ToolCallRequest[] = Object.values(accumulatedToolCallMap).map((entry, index) => ({
    id: entry.id || `${entry.name || "tool"}_${index}`,
    name: entry.name || "unknown",
    arguments: safeParseArguments(entry.inputJson),
  }));
  if (toolCalls.length > 0) {
    onToolCall(toolCalls);
  }
  onChunk("", true);
}

interface AnthropicStreamResult {
  content: string;
  toolCallMap: Record<number, { id?: string; name?: string; inputJson: string }>;
  finishReason: string | null;
}

/**
 * Anthropic 单次流式工具调用（内部函数）
 */
async function callAnthropicWithToolsStreamSingle(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  existingToolCallMap: Record<number, { id?: string; name?: string; inputJson: string }>
): Promise<AnthropicStreamResult> {
  const response = await smartFetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: buildAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType: "thinking" | "text" | "tool_use" | null = null;
  let currentToolIndex: number | null = null;
  const toolCallMap: Record<number, { id?: string; name?: string; inputJson: string; textStream?: ToolTextStreamState }> = {};

  // 复制已有的工具调用数据
  for (const [key, value] of Object.entries(existingToolCallMap)) {
    toolCallMap[Number(key)] = { ...value };
  }

  let seenStop = false;
  let finishReason: string | null = null;
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      try {
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        const json = JSON.parse(jsonStr);

        if (json.type === "message_stop") {
          seenStop = true;
          break;
        }

        // 捕获 message_delta 中的 stop_reason
        if (json.type === "message_delta" && json.delta?.stop_reason) {
          finishReason = json.delta.stop_reason;
        }

        if (json.type === "content_block_start") {
          const blockType = json.content_block?.type;
          if (blockType === "tool_use") {
            currentBlockType = "tool_use";
            const toolIndex = json.index ?? Object.keys(toolCallMap).length;
            currentToolIndex = toolIndex;
            if (!toolCallMap[toolIndex]) {
              toolCallMap[toolIndex] = {
                id: json.content_block?.id,
                name: json.content_block?.name,
                inputJson: "",
              };
            } else {
              // 更新 id 和 name（如果之前没有）
              if (json.content_block?.id) toolCallMap[toolIndex].id = json.content_block.id;
              if (json.content_block?.name) toolCallMap[toolIndex].name = json.content_block.name;
            }
          } else if (blockType === "thinking") {
            currentBlockType = "thinking";
          } else {
            currentBlockType = "text";
          }
        }

        if (json.type === "content_block_delta") {
          if (currentBlockType === "thinking") {
            const text = json.delta?.thinking;
            if (text) {
              onChunk(text, false, true);
            }
          } else if (currentBlockType === "text") {
            const text = json.delta?.text;
            if (text) {
              content += text;
              onChunk(text, false, false);
            }
          } else if (currentBlockType === "tool_use" && currentToolIndex !== null) {
            const partial = json.delta?.partial_json;
            if (partial) {
              toolCallMap[currentToolIndex].inputJson += partial;

              const entry = toolCallMap[currentToolIndex];
              entry.textStream = streamToolTextFromArgs(
                entry.inputJson,
                entry.name,
                entry.textStream,
                (deltaText) => {
                  const stableId = entry.id || `${entry.name || "tool"}_${String(currentToolIndex)}`;
                  onChunk(deltaText, false, false, {
                    kind: "tool_text",
                    toolName: entry.name,
                    toolCallId: stableId,
                  });
                }
              );
            }
          }
        }

        if (json.type === "content_block_stop") {
          currentBlockType = null;
          currentToolIndex = null;
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (seenStop) break;
  }

  if (seenStop) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  // 返回结果（不包含 textStream 状态）
  const cleanToolCallMap: Record<number, { id?: string; name?: string; inputJson: string }> = {};
  for (const [key, value] of Object.entries(toolCallMap)) {
    cleanToolCallMap[Number(key)] = {
      id: value.id,
      name: value.name,
      inputJson: value.inputJson,
    };
  }

  return {
    content,
    toolCallMap: cleanToolCallMap,
    finishReason,
  };
}
