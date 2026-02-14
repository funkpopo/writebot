/**
 * Anthropic-specific API functions.
 */

import { ToolDefinition, ToolCallRequest } from "../../../types/tools";
import { ConversationMessage } from "../../conversationManager";
import {
  toAnthropicTools,
  parseAnthropicToolCalls,
  serializeToolResult,
} from "../../toolApiAdapters";
import { getConfigRef, getMaxOutputTokens } from "../config";
import { resolveApiEndpoint } from "../endpointResolver";
import { smartFetch } from "../fetch";
import { ensureResponseOk } from "../errorUtils";
import { createAIResponse, createAIResponseWithTools, safeParseArguments } from "../helpers";
import { streamToolTextFromArgs, ToolTextStreamState } from "../streamToolText";
import type { AIResponse, AIResponseWithTools, StreamCallback, AIRequestOptions } from "../types";
import {
  OrderedAnthropicToolCallState,
  AnthropicStreamResult,
  MAX_CONTINUATION_ROUNDS,
  getOrderedToolCallEntries,
  sortToolEntriesByOrder,
  assignMissingToolCallOrder,
  buildAnthropicToolCallMapFromEntries,
  partitionAnthropicToolCallMapByCompleteness,
  toAnthropicToolCalls,
  resolveIncomingToolIndex,
} from "../toolContinuation";

function getAnthropicEndpoint(apiEndpoint: string, model: string): string {
  return resolveApiEndpoint({
    apiType: "anthropic",
    apiEndpoint,
    model,
  });
}

export function buildAnthropicMessages(
  messages: ConversationMessage[]
): Array<Record<string, unknown>> {
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
 * 调用 Anthropic API
 */
export async function callAnthropic(
  prompt: string,
  systemPrompt?: string,
  options?: AIRequestOptions
): Promise<AIResponse> {
  const config = getConfigRef();
  const response = await smartFetch(getAnthropicEndpoint(config.apiEndpoint, config.model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: options?.signal,
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  await ensureResponseOk("Anthropic", response);

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
 * 调用 Anthropic API（支持工具调用）
 */
export async function callAnthropicWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const config = getConfigRef();
  const response = await smartFetch(getAnthropicEndpoint(config.apiEndpoint, config.model), {
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

  await ensureResponseOk("Anthropic", response);

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
 * 流式调用 Anthropic API
 * 自动检测 extended thinking 的 thinking 内容块
 * 返回完整响应，内部使用流式请求
 */
export async function callAnthropicStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk?: StreamCallback,
  options?: AIRequestOptions
): Promise<AIResponse> {
  const config = getConfigRef();
  const response = await smartFetch(getAnthropicEndpoint(config.apiEndpoint, config.model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: options?.signal,
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  await ensureResponseOk("Anthropic", response);

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
 * 流式调用 Anthropic API（支持工具调用）
 */
export async function callAnthropicWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  const config = getConfigRef();
  const response = await smartFetch(getAnthropicEndpoint(config.apiEndpoint, config.model), {
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

  await ensureResponseOk("Anthropic", response);

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

export async function callAnthropicWithToolsStreamWithContinuation(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  let currentMessages = [...messages];
  let accumulatedContent = "";
  let accumulatedToolCallMap: Record<number, OrderedAnthropicToolCallState> = {};
  let nextToolOrder = 0;

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

    const orderedEntries = getOrderedToolCallEntries(accumulatedToolCallMap);
    nextToolOrder = assignMissingToolCallOrder(orderedEntries, nextToolOrder);
    const normalizedToolCallMap = buildAnthropicToolCallMapFromEntries(orderedEntries);
    const { completeEntries, incompleteEntries } =
      partitionAnthropicToolCallMapByCompleteness(normalizedToolCallMap);

    if (completeEntries.length > 0) {
      onToolCall(toAnthropicToolCalls(completeEntries));
    }

    if (result.finishReason !== "max_tokens") {
      if (incompleteEntries.length > 0) {
        onToolCall(toAnthropicToolCalls(incompleteEntries));
      }
      onChunk("", true);
      return;
    }

    if (incompleteEntries.length === 0) {
      onChunk("", true);
      return;
    }

    accumulatedToolCallMap = buildAnthropicToolCallMapFromEntries(incompleteEntries);

    const partialAssistantMessage: ConversationMessage = {
      role: "assistant",
      content: accumulatedContent,
      toolCalls: toAnthropicToolCalls(incompleteEntries),
    };

    currentMessages = [
      ...messages,
      partialAssistantMessage,
      { role: "user", content: "Continue the unfinished tool calls and output only the remaining JSON arguments." },
    ];
  }

  const remainingEntries = sortToolEntriesByOrder(getOrderedToolCallEntries(accumulatedToolCallMap));
  if (remainingEntries.length > 0) {
    onToolCall(toAnthropicToolCalls(remainingEntries));
  }
  onChunk("", true);
}

/**
 * Anthropic single-pass streaming tool-calls (internal)
 */
export async function callAnthropicWithToolsStreamSingle(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  existingToolCallMap: Record<number, OrderedAnthropicToolCallState>
): Promise<AnthropicStreamResult> {
  const config = getConfigRef();
  const response = await smartFetch(getAnthropicEndpoint(config.apiEndpoint, config.model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: getMaxOutputTokens(),
      system: systemPrompt || "You are a professional writing assistant.",
      messages: buildAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
      stream: true,
    }),
  });

  await ensureResponseOk("Anthropic", response);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to get response stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType: "thinking" | "text" | "tool_use" | null = null;
  let currentToolIndex: number | null = null;
  const toolCallMap: Record<
    number,
    OrderedAnthropicToolCallState & { textStream?: ToolTextStreamState }
  > = {};

  for (const [key, value] of Object.entries(existingToolCallMap)) {
    toolCallMap[Number(key)] = { ...value };
  }

  const existingOrders = Object.values(toolCallMap)
    .map((entry) => entry.order)
    .filter((order): order is number => typeof order === "number");
  let nextToolOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;

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

        if (json.type === "message_delta" && json.delta?.stop_reason) {
          finishReason = json.delta.stop_reason;
        }

        if (json.type === "content_block_start") {
          const blockType = json.content_block?.type;
          if (blockType === "tool_use") {
            currentBlockType = "tool_use";
            const incomingIndex = typeof json.index === "number" ? json.index : undefined;
            const incomingId = json.content_block?.id;
            const toolIndex = resolveIncomingToolIndex(toolCallMap, incomingIndex, incomingId);
            currentToolIndex = toolIndex;
            if (!toolCallMap[toolIndex]) {
              toolCallMap[toolIndex] = {
                id: incomingId,
                name: json.content_block?.name,
                inputJson: "",
                order: nextToolOrder++,
              };
            } else {
              const entry = toolCallMap[toolIndex];
              if (typeof entry.order !== "number") {
                entry.order = nextToolOrder++;
              }
              if (incomingId) entry.id = incomingId;
              if (json.content_block?.name) entry.name = json.content_block.name;
            }
          } else if (blockType === "thinking") {
            currentBlockType = "thinking";
          } else {
            currentBlockType = "text";
          }
        }

        if (json.type === "content_block_delta") {
          if (currentBlockType === "thinking") {
            const thinkingText = json.delta?.thinking;
            if (thinkingText) {
              onChunk(thinkingText, false, true);
            }
          } else if (currentBlockType === "text") {
            const textDelta = json.delta?.text;
            if (textDelta) {
              content += textDelta;
              onChunk(textDelta, false, false);
            }
          } else if (currentBlockType === "tool_use" && currentToolIndex !== null) {
            const partial = json.delta?.partial_json;
            if (partial) {
              const entry = toolCallMap[currentToolIndex];
              entry.inputJson += partial;

              entry.textStream = streamToolTextFromArgs(
                entry.inputJson,
                entry.name,
                entry.textStream,
                (deltaText) => {
                  const stableId = entry.id || `${entry.name || "tool"}_${entry.order ?? currentToolIndex}`;
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
        // Ignore parse errors.
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

  const cleanToolCallMap: Record<number, OrderedAnthropicToolCallState> = {};
  for (const [key, value] of Object.entries(toolCallMap)) {
    cleanToolCallMap[Number(key)] = {
      id: value.id,
      name: value.name,
      inputJson: value.inputJson,
      order: value.order,
    };
  }

  return {
    content,
    toolCallMap: cleanToolCallMap,
    finishReason,
  };
}
