/**
 * Gemini-specific API functions.
 */

import { ToolDefinition, ToolCallRequest } from "../../../types/tools";
import { ConversationMessage } from "../../conversationManager";
import { toGeminiTools, parseGeminiToolCalls } from "../../toolApiAdapters";
import { getConfigRef, getMaxOutputTokens } from "../config";
import { resolveApiEndpoint, withQueryParams } from "../endpointResolver";
import { smartFetch } from "../fetch";
import { createAIResponse, createAIResponseWithTools, safeParseArguments } from "../helpers";
import type { AIResponse, AIResponseWithTools, StreamCallback } from "../types";

function buildSystemPromptPrelude(systemPrompt?: string): Array<Record<string, unknown>> {
  if (!systemPrompt) return [];

  return [
    {
      role: "user",
      parts: [{ text: systemPrompt }],
    },
    {
      role: "model",
      parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
    },
  ];
}

export function buildGeminiContents(
  messages: ConversationMessage[]
): Array<Record<string, unknown>> {
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

function buildGeminiEndpoint(stream = false): string {
  const config = getConfigRef();
  const endpoint = resolveApiEndpoint({
    apiType: "gemini",
    apiEndpoint: config.apiEndpoint,
    model: config.model,
    stream,
  });

  const query: Record<string, string> = { key: config.apiKey };
  if (stream) {
    query.alt = "sse";
  }

  return withQueryParams(endpoint, query);
}

function extractTextAndThinking(parts: unknown): { content: string; thinking: string } {
  let content = "";
  let thinking = "";

  if (!Array.isArray(parts)) {
    return { content, thinking };
  }

  for (const part of parts) {
    const item = part as { text?: string; thought?: boolean };
    if (!item?.text) continue;
    if (item.thought) {
      thinking += item.text;
    } else {
      content += item.text;
    }
  }

  return { content, thinking };
}

function forEachStreamPart(payload: any, callback: (part: any) => void): void {
  const events = Array.isArray(payload) ? payload : [payload];
  for (const event of events) {
    const parts = event?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      callback(part);
    }
  }
}

function parseToolCallArguments(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs === "string") {
    return safeParseArguments(rawArgs);
  }
  if (rawArgs && typeof rawArgs === "object") {
    return rawArgs as Record<string, unknown>;
  }
  return {};
}

/**
 * 调用 Gemini API
 */
export async function callGemini(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const contents: Array<Record<string, unknown>> = [
    ...buildSystemPromptPrelude(systemPrompt),
    {
      role: "user",
      parts: [{ text: prompt }],
    },
  ];

  const response = await smartFetch(buildGeminiEndpoint(false), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: getMaxOutputTokens(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const { content, thinking } = extractTextAndThinking(data?.candidates?.[0]?.content?.parts);

  return createAIResponse(content, thinking || undefined);
}

/**
 * 调用 Gemini API（支持工具调用）
 */
export async function callGeminiWithTools(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt?: string
): Promise<AIResponseWithTools> {
  const contents = [
    ...buildSystemPromptPrelude(systemPrompt),
    ...buildGeminiContents(messages),
  ];

  const functionDeclarations = toGeminiTools(tools).functionDeclarations;
  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: getMaxOutputTokens(),
    },
  };

  if (functionDeclarations.length > 0) {
    requestBody.tools = [{ functionDeclarations }];
  }

  const response = await smartFetch(buildGeminiEndpoint(false), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const { content, thinking } = extractTextAndThinking(data?.candidates?.[0]?.content?.parts);
  const toolCalls = parseGeminiToolCalls(data);

  return createAIResponseWithTools(content, thinking || undefined, toolCalls);
}

/**
 * 流式调用 Gemini API
 */
export async function callGeminiStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const contents: Array<Record<string, unknown>> = [
    ...buildSystemPromptPrelude(systemPrompt),
    {
      role: "user",
      parts: [{ text: prompt }],
    },
  ];

  const response = await smartFetch(buildGeminiEndpoint(true), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: getMaxOutputTokens(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to get response stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let thinking = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") continue;

      try {
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        if (!jsonStr) continue;

        const payload = JSON.parse(jsonStr);
        forEachStreamPart(payload, (part) => {
          if (part?.thought && part?.text) {
            thinking += part.text;
            onChunk?.(part.text, false, true);
            return;
          }

          if (part?.text) {
            content += part.text;
            onChunk?.(part.text, false, false);
          }
        });
      } catch {
        // Ignore parse errors.
      }
    }
  }

  onChunk?.("", true);
  return createAIResponse(content, thinking || undefined);
}

/**
 * 流式调用 Gemini API（支持工具调用）
 */
export async function callGeminiWithToolsStream(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  systemPrompt: string | undefined,
  onChunk: StreamCallback,
  onToolCall: (toolCalls: ToolCallRequest[]) => void
): Promise<void> {
  const contents = [
    ...buildSystemPromptPrelude(systemPrompt),
    ...buildGeminiContents(messages),
  ];

  const functionDeclarations = toGeminiTools(tools).functionDeclarations;
  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: getMaxOutputTokens(),
    },
  };

  if (functionDeclarations.length > 0) {
    requestBody.tools = [{ functionDeclarations }];
  }

  const response = await smartFetch(buildGeminiEndpoint(true), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to get response stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallMap = new Map<string, ToolCallRequest>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") continue;

      try {
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        if (!jsonStr) continue;

        const payload = JSON.parse(jsonStr);
        forEachStreamPart(payload, (part) => {
          const functionCall = part?.functionCall || part?.function_call;
          if (functionCall) {
            const name = functionCall.name || "unknown";
            const args = parseToolCallArguments(
              functionCall.args ?? functionCall.arguments ?? functionCall.argsJson
            );
            const explicitId =
              typeof functionCall.id === "string" && functionCall.id.trim()
                ? functionCall.id.trim()
                : "";
            const dedupeKey = explicitId || `${name}:${JSON.stringify(args)}`;

            if (!toolCallMap.has(dedupeKey)) {
              toolCallMap.set(dedupeKey, {
                id: explicitId || `${name}_${toolCallMap.size}`,
                name,
                arguments: args,
              });
            }
            return;
          }

          if (part?.thought && part?.text) {
            onChunk(part.text, false, true);
            return;
          }

          if (part?.text) {
            onChunk(part.text, false, false);
          }
        });
      } catch {
        // Ignore parse errors.
      }
    }
  }

  const toolCalls = Array.from(toolCallMap.values());
  if (toolCalls.length > 0) {
    onToolCall(toolCalls);
  }

  onChunk("", true);
}
