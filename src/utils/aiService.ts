/**
 * AI 服务接口
 * 支持 OpenAI、Anthropic、Gemini 三种 API 格式
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
  toGeminiTools,
  parseGeminiToolCalls,
  serializeToolResult,
} from "./toolApiAdapters";

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

// 默认配置（需要用户配置实际的 API 密钥）
const defaultConfig: AISettings = getDefaultSettings();

let config: AISettings = { ...defaultConfig };

const MODEL_MAX_OUTPUT_TOKENS: Array<{ match: RegExp; maxTokens: number }> = [
  // OpenAI（保守上限，避免超过模型限制）
  { match: /gpt-4o-mini/i, maxTokens: 4096 },
  { match: /gpt-4o/i, maxTokens: 4096 },
  { match: /gpt-4-turbo/i, maxTokens: 4096 },
  { match: /gpt-4/i, maxTokens: 4096 },
  { match: /gpt-3\.5/i, maxTokens: 4096 },
  // Anthropic
  { match: /claude-3-5|claude-3\.5/i, maxTokens: 8192 },
  { match: /claude-3/i, maxTokens: 4096 },
  // Gemini
  { match: /gemini-1\.5/i, maxTokens: 8192 },
  { match: /gemini/i, maxTokens: 2048 },
];

const DEFAULT_MAX_OUTPUT_TOKENS: Record<APIType, number> = {
  openai: 4096,
  anthropic: 4096,
  gemini: 2048,
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

function buildGeminiContents(messages: ConversationMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "user") {
      output.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        parts.push(
          ...message.toolCalls.map((call) => ({
            functionCall: {
              name: call.name,
              args: call.arguments ?? {},
            },
          }))
        );
      }
      output.push({ role: "model", parts });
      continue;
    }

    if (message.role === "tool") {
      const results = message.toolResults || [];
      if (results.length > 0) {
        output.push({
          role: "user",
          parts: results.map((result) => ({
            functionResponse: {
              name: result.name,
              response: result.success
                ? { result: result.result ?? true }
                : { error: result.error || "Tool execution failed" },
            },
          })),
        });
      } else {
        output.push({ role: "user", parts: [{ text: message.content }] });
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
    case "gemini":
      return callGemini(prompt, systemPrompt);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 流式调用 AI API（根据配置的 API 类型选择对应格式）
 */
async function callAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  assertAIConfig();

  switch (config.apiType) {
    case "openai":
      return callOpenAIStream(prompt, systemPrompt, onChunk);
    case "anthropic":
      return callAnthropicStream(prompt, systemPrompt, onChunk);
    case "gemini":
      return callGeminiStream(prompt, systemPrompt, onChunk);
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
    case "gemini":
      return callGeminiWithTools(messages, tools, systemPrompt);
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
    case "gemini":
      return callGeminiWithToolsStream(messages, tools, systemPrompt, onChunk, onToolCall);
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

  const response = await fetch(config.apiEndpoint, {
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
  const response = await fetch(config.apiEndpoint, {
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
  return { content, thinking: thinking || undefined };
}

/**
 * 调用 Gemini API
 */
async function callGemini(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const contents = [];
  if (systemPrompt) {
    contents.push({
      role: "user",
      parts: [{ text: systemPrompt }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: prompt }],
  });

  // Gemini API endpoint 格式: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
  const baseEndpoint = config.apiEndpoint.includes("{model}")
    ? config.apiEndpoint.replace("{model}", config.model)
    : config.apiEndpoint;
  const endpoint = `${baseEndpoint}?key=${config.apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: getMaxOutputTokens(config.apiType, config.model),
        },
      }),
    });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  // Gemini 可能返回带有 thought 标记的 parts
  const parts = data.candidates[0].content.parts;
  let thinking = "";
  let content = "";
  for (const part of parts) {
    if (part.thought) {
      thinking += part.text || "";
    } else {
      content += part.text || "";
    }
  }
  return { content, thinking: thinking || undefined };
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

  const response = await fetch(config.apiEndpoint, {
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

  return { content: finalContent, thinking, toolCalls };
}

/**
 * 调用 Anthropic API（支持工具调用）
 */
async function callAnthropicWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const response = await fetch(config.apiEndpoint, {
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

  return { content, thinking: thinking || undefined, toolCalls };
}

/**
 * 调用 Gemini API（支持工具调用）
 */
async function callGeminiWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const contents = buildGeminiContents(messages);
  if (systemPrompt) {
    contents.unshift(
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
      }
    );
  }

  const baseEndpoint = config.apiEndpoint.includes("{model}")
    ? config.apiEndpoint.replace("{model}", config.model)
    : config.apiEndpoint;
  const endpoint = `${baseEndpoint}?key=${config.apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      tools: [{ functionDeclarations: toGeminiTools(tools).functionDeclarations }],
      generationConfig: {
        maxOutputTokens: getMaxOutputTokens(config.apiType, config.model),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  let thinking = "";
  let content = "";
  for (const part of parts) {
    if (part?.thought) {
      thinking += part.text || "";
    } else if (part?.text) {
      content += part.text;
    }
  }

  const toolCalls = parseGeminiToolCalls(data);

  return { content, thinking: thinking || undefined, toolCalls };
}

/**
 * 流式调用 OpenAI API
 * 支持 reasoning_content 字段和 <think></think> 标签格式的思维内容
 */
async function callOpenAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch(config.apiEndpoint, {
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
  // 用于跟踪 <think> 标签状态
  let inThinkTag = false;
  let contentBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // 处理剩余的内容缓冲区
      if (contentBuffer) {
        onChunk(contentBuffer, false, false);
      }
      onChunk("", true);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("`n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          // 检测 reasoning_content（思维过程）
          if (delta?.reasoning_content) {
            onChunk(delta.reasoning_content, false, true);
          }
          // 正常内容 - 需要检测 <think></think> 标签
          if (delta?.content) {
            contentBuffer += delta.content;
            // 处理 <think> 标签
            while (contentBuffer.length > 0) {
              if (inThinkTag) {
                // 在 think 标签内，查找结束标签
                const endIndex = contentBuffer.indexOf("</think>");
                if (endIndex !== -1) {
                  // 找到结束标签，输出思维内容
                  const thinkContent = contentBuffer.substring(0, endIndex);
                  if (thinkContent) {
                    onChunk(thinkContent, false, true);
                  }
                  contentBuffer = contentBuffer.substring(endIndex + 8);
                  inThinkTag = false;
                } else {
                  // 没有找到结束标签，检查是否有部分结束标签
                  // 保留可能是部分结束标签的内容
                  const partialEnd = contentBuffer.lastIndexOf("<");
                  if (partialEnd !== -1 && partialEnd > contentBuffer.length - 9) {
                    // 可能是部分 </think> 标签，保留
                    const safeContent = contentBuffer.substring(0, partialEnd);
                    if (safeContent) {
                      onChunk(safeContent, false, true);
                    }
                    contentBuffer = contentBuffer.substring(partialEnd);
                  } else {
                    // 输出所有内容作为思维
                    onChunk(contentBuffer, false, true);
                    contentBuffer = "";
                  }
                  break;
                }
              } else {
                // 不在 think 标签内，查找开始标签
                const startIndex = contentBuffer.indexOf("<think>");
                if (startIndex !== -1) {
                  // 找到开始标签，先输出之前的普通内容
                  const normalContent = contentBuffer.substring(0, startIndex);
                  if (normalContent) {
                    onChunk(normalContent, false, false);
                  }
                  contentBuffer = contentBuffer.substring(startIndex + 7);
                  inThinkTag = true;
                } else {
                  // 没有找到开始标签，检查是否有部分开始标签
                  const partialStart = contentBuffer.lastIndexOf("<");
                  if (partialStart !== -1 && partialStart > contentBuffer.length - 8) {
                    // 可能是部分 <think> 标签，保留
                    const safeContent = contentBuffer.substring(0, partialStart);
                    if (safeContent) {
                      onChunk(safeContent, false, false);
                    }
                    contentBuffer = contentBuffer.substring(partialStart);
                  } else {
                    // 输出所有内容作为普通内容
                    onChunk(contentBuffer, false, false);
                    contentBuffer = "";
                  }
                  break;
                }
              }
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
}

/**
 * 流式调用 Anthropic API
 * 自动检测 extended thinking 的 thinking 内容块
 */
async function callAnthropicStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  const response = await fetch(config.apiEndpoint, {
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk("", true);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("`n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
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
            onChunk(text, false, isThinking);
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
  }
}

/**
 * 流式调用 Gemini API
 */
async function callGeminiStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  const contents = [];
  if (systemPrompt) {
    contents.push({
      role: "user",
      parts: [{ text: systemPrompt }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: prompt }],
  });

  // Gemini 流式 API: streamGenerateContent
  const baseEndpoint = config.apiEndpoint.includes("{model}")
    ? config.apiEndpoint.replace("{model}", config.model)
    : config.apiEndpoint;
  const endpoint = baseEndpoint.replace(":generateContent", ":streamGenerateContent");
  const streamEndpoint = `${endpoint}?key=${config.apiKey}&alt=sse`;

  const response = await fetch(streamEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: getMaxOutputTokens(config.apiType, config.model),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk("", true);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("`n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const parts = json.candidates?.[0]?.content?.parts;
        if (parts && Array.isArray(parts)) {
          for (const part of parts) {
            // 检测 thought 字段
            if (part.thought) {
              onChunk(part.text || "", false, true);
            } else if (part.text) {
              onChunk(part.text, false, false);
            }
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
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

  const response = await fetch(config.apiEndpoint, {
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
  let inThinkTag = false;
  let contentBuffer = "";
  const toolCallMap: Record<number, { id?: string; name?: string; arguments: string }> = {};

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
    if (done) {
      if (contentBuffer) {
        onChunk(contentBuffer, false, false);
      }
      onChunk("", true);
      flushToolCalls();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
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

          if (delta?.content) {
            contentBuffer += delta.content;
            while (contentBuffer.length > 0) {
              if (inThinkTag) {
                const endIndex = contentBuffer.indexOf("</think>");
                if (endIndex !== -1) {
                  const thinkContent = contentBuffer.substring(0, endIndex);
                  if (thinkContent) {
                    onChunk(thinkContent, false, true);
                  }
                  contentBuffer = contentBuffer.substring(endIndex + 8);
                  inThinkTag = false;
                } else {
                  const partialEnd = contentBuffer.lastIndexOf("<");
                  if (partialEnd !== -1 && partialEnd > contentBuffer.length - 9) {
                    const safeContent = contentBuffer.substring(0, partialEnd);
                    if (safeContent) {
                      onChunk(safeContent, false, true);
                    }
                    contentBuffer = contentBuffer.substring(partialEnd);
                  } else {
                    onChunk(contentBuffer, false, true);
                    contentBuffer = "";
                  }
                  break;
                }
              } else {
                const startIndex = contentBuffer.indexOf("<think>");
                if (startIndex !== -1) {
                  const normalContent = contentBuffer.substring(0, startIndex);
                  if (normalContent) {
                    onChunk(normalContent, false, false);
                  }
                  contentBuffer = contentBuffer.substring(startIndex + 7);
                  inThinkTag = true;
                } else {
                  const partialStart = contentBuffer.lastIndexOf("<");
                  if (partialStart !== -1 && partialStart > contentBuffer.length - 8) {
                    const safeContent = contentBuffer.substring(0, partialStart);
                    if (safeContent) {
                      onChunk(safeContent, false, false);
                    }
                    contentBuffer = contentBuffer.substring(partialStart);
                  } else {
                    onChunk(contentBuffer, false, false);
                    contentBuffer = "";
                  }
                  break;
                }
              }
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
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
  const response = await fetch(config.apiEndpoint, {
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
    if (done) {
      onChunk("", true);
      flushToolCalls();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
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
  }
}

/**
 * 流式调用 Gemini API（支持工具调用）
 */
async function callGeminiWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  const contents = buildGeminiContents(messages);
  if (systemPrompt) {
    contents.unshift(
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
      }
    );
  }

  const baseEndpoint = config.apiEndpoint.includes("{model}")
    ? config.apiEndpoint.replace("{model}", config.model)
    : config.apiEndpoint;
  const endpoint = baseEndpoint.replace(":generateContent", ":streamGenerateContent");
  const streamEndpoint = `${endpoint}?key=${config.apiKey}&alt=sse`;

  const response = await fetch(streamEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      tools: [{ functionDeclarations: toGeminiTools(tools).functionDeclarations }],
      generationConfig: {
        maxOutputTokens: getMaxOutputTokens(config.apiType, config.model),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls: ToolCallRequest[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk("", true);
      if (toolCalls.length > 0) {
        onToolCall(toolCalls);
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const parts = json.candidates?.[0]?.content?.parts;
        if (parts && Array.isArray(parts)) {
          for (const part of parts) {
            if (part?.functionCall) {
              const rawArgs = part.functionCall.args;
              const parsedArgs =
                typeof rawArgs === "string"
                  ? safeParseArguments(rawArgs)
                  : (rawArgs as Record<string, unknown>) || {};
              toolCalls.push({
                id: part.functionCall.id || `${part.functionCall.name || "tool"}_${toolCalls.length}`,
                name: part.functionCall.name || "unknown",
                arguments: parsedArgs,
              });
            } else if (part?.thought) {
              onChunk(part.text || "", false, true);
            } else if (part?.text) {
              onChunk(part.text, false, false);
            }
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
}

/**
 * 文本润色
 */
export async function polishText(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的文本润色助手。
要求：
1. 对文本进行润色，使其更加流畅、专业、易读
2. 保持原文的核心意思不变
3. 保持原文的段落结构和格式
4. 直接输出润色后的文本，不要添加任何解释、标签、引号或前缀
5. 不要使用 Markdown 格式`;
  return callAI(text, systemPrompt);
}

/**
 * 翻译文本（中英互译）
 */
export async function translateText(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的翻译助手。
要求：
1. 如果输入是中文，翻译成地道的英文
2. 如果输入是英文，翻译成流畅的中文
3. 如果是中英混合，将整体翻译成另一种语言
4. 保持原文的格式和段落结构
5. 直接输出翻译结果，不要添加任何解释、标签、引号或前缀
6. 不要使用 Markdown 格式`;
  return callAI(text, systemPrompt);
}

/**
 * 语法检查
 */
export async function checkGrammar(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的语法检查和修正助手。
要求：
1. 检查文本中的语法错误、拼写错误、标点错误
2. 直接输出修正后的完整文本
3. 保持原文的格式和段落结构
4. 如果没有错误，直接返回原文
5. 不要添加任何解释、标签、引号或前缀，只输出修正后的文本
6. 不要使用 Markdown 格式`;
  return callAI(text, systemPrompt);
}

/**
 * 生成摘要
 */
export async function summarizeText(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的文本摘要助手。
要求：
1. 提取文本的核心观点和关键信息
2. 生成简洁、准确的摘要
3. 摘要长度控制在原文的20%-30%
4. 直接输出摘要内容，不要添加"摘要："等前缀或任何解释
5. 不要使用 Markdown 格式`;
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
  const systemPrompt = `你是一个专业的写作续写助手。
要求：
1. 以${styleDesc}的风格续写文本
2. 保持与原文内容连贯、风格一致
3. 续写长度与原文相当
4. 输出格式：原文 + 续写内容（无缝衔接，不要添加分隔符）
5. 不要添加任何解释或标签
6. 不要使用 Markdown 格式`;
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
  const systemPrompt = `你是一个专业的内容生成助手。
要求：
1. 以${styleDesc}的风格根据用户要求生成内容
2. 输出内容要完整、连贯
3. 不要使用 Markdown 格式
4. 不要添加任何解释、标签、引号或前缀`;
  return callAI(prompt, systemPrompt);
}

// ==================== 流式版本 ====================

/**
 * 文本润色（流式）
 */
export async function polishTextStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的文本润色助手。
要求：
1. 对文本进行润色，使其更加流畅、专业、易读
2. 保持原文的核心意思不变
3. 保持原文的段落结构和格式
4. 直接输出润色后的文本，不要添加任何解释、标签、引号或前缀
5. 不要使用 Markdown 格式`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 翻译文本（流式）
 */
export async function translateTextStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的翻译助手。
要求：
1. 如果输入是中文，翻译成地道的英文
2. 如果输入是英文，翻译成流畅的中文
3. 如果是中英混合，将整体翻译成另一种语言
4. 保持原文的格式和段落结构
5. 直接输出翻译结果，不要添加任何解释、标签、引号或前缀
6. 不要使用 Markdown 格式`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 语法检查（流式）
 */
export async function checkGrammarStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的语法检查和修正助手。
要求：
1. 检查文本中的语法错误、拼写错误、标点错误
2. 直接输出修正后的完整文本
3. 保持原文的格式和段落结构
4. 如果没有错误，直接返回原文
5. 不要添加任何解释、标签、引号或前缀，只输出修正后的文本
6. 不要使用 Markdown 格式`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 生成摘要（流式）
 */
export async function summarizeTextStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的文本摘要助手。
要求：
1. 提取文本的核心观点和关键信息
2. 生成简洁、准确的摘要
3. 摘要长度控制在原文的20%-30%
4. 直接输出摘要内容，不要添加"摘要："等前缀或任何解释
5. 不要使用 Markdown 格式`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 续写内容（流式）
 */
export async function continueWritingStream(
  text: string,
  style: string,
  onChunk: StreamCallback
): Promise<void> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = `你是一个专业的写作续写助手。
要求：
1. 以${styleDesc}的风格续写文本
2. 保持与原文内容连贯、风格一致
3. 续写长度与原文相当
4. 输出格式：原文 + 续写内容（无缝衔接，不要添加分隔符）
5. 不要添加任何解释或标签
6. 不要使用 Markdown 格式`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 生成内容（流式）
 */
export async function generateContentStream(
  prompt: string,
  style: string,
  onChunk: StreamCallback
): Promise<void> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = `你是一个专业的内容生成助手。
要求：
1. 以${styleDesc}的风格根据用户要求生成内容
2. 输出内容要完整、连贯
3. 不要使用 Markdown 格式
4. 不要添加任何解释、标签、引号或前缀`;
  return callAIStream(prompt, systemPrompt, onChunk);
}

