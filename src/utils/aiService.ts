/**
 * AI 服务接口
 * 支持 OpenAI、Anthropic 两种 API 格式
 * 支持流式输出
 */

import {
  APIType,
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

// 流式回调类型 - 支持思维过程
export type StreamCallback = (chunk: string, done: boolean, isThinking?: boolean) => void;

// AI 响应结果（包含思维内容）
export interface AIResponse {
  content: string;
  thinking?: string;
}

export interface AIResponseWithTools extends AIResponse {
  toolCalls?: ToolCallRequest[];
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

const MODEL_MAX_OUTPUT_TOKENS: Array<{ match: RegExp; maxTokens: number }> = [
  // OpenAI
  { match: /gpt-5.2/i, maxTokens: 65536 },
  { match: /gpt-5.2-codex/i, maxTokens: 65536 },
  // Anthropic
  { match: /claude-4-5|claude-4\.5/i, maxTokens: 65536 },
];

const DEFAULT_MAX_OUTPUT_TOKENS: Record<APIType, number> = {
  openai: 65536,
  anthropic: 65536,
};

function getMaxOutputTokens(apiType: APIType, model: string): number {
  const matched = MODEL_MAX_OUTPUT_TOKENS.find((rule) => rule.match.test(model));
  return matched?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS[apiType];
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
  return { content: sanitizeMarkdownToPlainText(finalContent), thinking };
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
      return callOpenAIWithToolsStream(messages, tools, systemPrompt, onChunk, onToolCall);
    case "anthropic":
      return callAnthropicWithToolsStream(messages, tools, systemPrompt, onChunk, onToolCall);
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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

  return { content: finalContent, thinking };
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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
  return { content: sanitizeMarkdownToPlainText(content), thinking: thinking || undefined };
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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

  return { content: sanitizeMarkdownToPlainText(finalContent), thinking, toolCalls };
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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

  return { content: sanitizeMarkdownToPlainText(content), thinking: thinking || undefined, toolCalls };
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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
  return extractThinking(content, reasoning || undefined);
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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

  return { content: sanitizeMarkdownToPlainText(content), thinking: thinking || undefined };
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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
  const toolCallMap: Record<number, { id?: string; name?: string; arguments: string }> = {};
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
      max_tokens: getMaxOutputTokens(config.apiType, config.model),
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
  const toolCallMap: Record<number, { id?: string; name?: string; inputJson: string }> = {};
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
