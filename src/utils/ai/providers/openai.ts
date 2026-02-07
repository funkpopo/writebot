/**
 * OpenAI-specific API functions.
 */

import { ToolDefinition, ToolCallRequest } from "../../../types/tools";
import { ConversationMessage } from "../../conversationManager";
import {
  toOpenAITools,
  parseOpenAIToolCalls,
  serializeToolResult,
} from "../../toolApiAdapters";
import { getConfigRef, getMaxOutputTokens } from "../config";
import { smartFetch } from "../fetch";
import { createAIResponse, createAIResponseWithTools, extractThinking, safeParseArguments } from "../helpers";
import { streamToolTextFromArgs, ToolTextStreamState } from "../streamToolText";
import type { AIResponse, AIResponseWithTools, StreamCallback } from "../types";
import {
  OrderedOpenAIToolCallState,
  StreamResult,
  MAX_CONTINUATION_ROUNDS,
  getOrderedToolCallEntries,
  sortToolEntriesByOrder,
  assignMissingToolCallOrder,
  buildOpenAIToolCallMapFromEntries,
  partitionOpenAIToolCallMapByCompleteness,
  toOpenAIToolCalls,
  resolveIncomingToolIndex,
} from "../toolContinuation";

export function buildOpenAIMessages(
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

/**
 * 调用 OpenAI API
 */
export async function callOpenAI(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const config = getConfigRef();
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
 * 调用 OpenAI API（支持工具调用）
 */
export async function callOpenAIWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const config = getConfigRef();
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
 * 流式调用 OpenAI API
 * 支持 reasoning_content 字段和 <think></think> 标签格式的思维内容
 * 返回完整响应，内部使用流式请求
 */
export async function callOpenAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const config = getConfigRef();
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
 * 流式调用 OpenAI API（支持工具调用）
 */
export async function callOpenAIWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  const config = getConfigRef();
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
 * OpenAI 流式工具调用（支持截断后继续补全）
 */
export async function callOpenAIWithToolsStreamWithContinuation(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  let currentMessages = [...messages];
  let accumulatedContent = "";
  let accumulatedToolCallMap: Record<number, OrderedOpenAIToolCallState> = {};
  let nextToolOrder = 0;

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

    const orderedEntries = getOrderedToolCallEntries(accumulatedToolCallMap);
    nextToolOrder = assignMissingToolCallOrder(orderedEntries, nextToolOrder);
    const normalizedToolCallMap = buildOpenAIToolCallMapFromEntries(orderedEntries);
    const { completeEntries, incompleteEntries } =
      partitionOpenAIToolCallMapByCompleteness(normalizedToolCallMap);

    if (completeEntries.length > 0) {
      onToolCall(toOpenAIToolCalls(completeEntries));
    }

    if (result.finishReason !== "length") {
      if (incompleteEntries.length > 0) {
        onToolCall(toOpenAIToolCalls(incompleteEntries));
      }
      onChunk("", true);
      return;
    }

    if (incompleteEntries.length === 0) {
      onChunk("", true);
      return;
    }

    accumulatedToolCallMap = buildOpenAIToolCallMapFromEntries(incompleteEntries);

    const partialAssistantMessage: ConversationMessage = {
      role: "assistant",
      content: accumulatedContent,
      toolCalls: toOpenAIToolCalls(incompleteEntries),
    };

    currentMessages = [
      ...messages,
      partialAssistantMessage,
      { role: "user", content: "Continue the unfinished tool calls and output only the remaining JSON arguments." },
    ];
  }

  const remainingEntries = sortToolEntriesByOrder(getOrderedToolCallEntries(accumulatedToolCallMap));
  if (remainingEntries.length > 0) {
    onToolCall(toOpenAIToolCalls(remainingEntries));
  }
  onChunk("", true);
}

export async function callOpenAIWithToolsStreamSingle(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  existingToolCallMap: Record<number, OrderedOpenAIToolCallState>
): Promise<StreamResult> {
  const config = getConfigRef();
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
    throw new Error(`OpenAI API request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to get response stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallMap: Record<
    number,
    OrderedOpenAIToolCallState & { textStream?: ToolTextStreamState }
  > = {};

  for (const [key, value] of Object.entries(existingToolCallMap)) {
    toolCallMap[Number(key)] = { ...value };
  }

  const existingOrders = Object.values(toolCallMap)
    .map((entry) => entry.order)
    .filter((order): order is number => typeof order === "number");
  let nextToolOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;

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

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (delta?.reasoning_content) {
            onChunk(delta.reasoning_content, false, true);
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const index = resolveIncomingToolIndex(toolCallMap, toolCall.index, toolCall.id);
              if (!toolCallMap[index]) {
                toolCallMap[index] = { arguments: "", order: nextToolOrder++ };
              }

              const entry = toolCallMap[index];
              if (typeof entry.order !== "number") {
                entry.order = nextToolOrder++;
              }
              if (toolCall.id) entry.id = toolCall.id;
              if (toolCall.function?.name) entry.name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                entry.arguments += toolCall.function.arguments;
              }

              entry.textStream = streamToolTextFromArgs(
                entry.arguments,
                entry.name,
                entry.textStream,
                (deltaText) => {
                  const stableId = entry.id || `${entry.name || "tool"}_${entry.order ?? index}`;
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
          // Ignore parse errors.
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

  const cleanToolCallMap: Record<number, OrderedOpenAIToolCallState> = {};
  for (const [key, value] of Object.entries(toolCallMap)) {
    cleanToolCallMap[Number(key)] = {
      id: value.id,
      name: value.name,
      arguments: value.arguments,
      order: value.order,
    };
  }

  return {
    content,
    toolCallMap: cleanToolCallMap,
    finishReason,
  };
}
