import { APIType } from "./storageService";
import { ToolCallRequest, ToolCallResult } from "../types/tools";
import { serializeToolResult } from "./toolApiAdapters";

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallRequest[];
  toolResults?: ToolCallResult[];
  thinking?: string;
}

export class ConversationManager {
  private messages: ConversationMessage[] = [];
  private pendingToolCalls: ToolCallRequest[] = [];

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistantMessage(content: string, toolCalls?: ToolCallRequest[], thinking?: string): void {
    this.messages.push({ role: "assistant", content, toolCalls, thinking });
    if (toolCalls && toolCalls.length > 0) {
      this.pendingToolCalls = [...toolCalls];
    } else {
      this.pendingToolCalls = [];
    }
  }

  addToolResult(result: ToolCallResult): void {
    const content = result.success
      ? serializeToolResult(result.result)
      : serializeToolResult({ error: result.error || "Tool execution failed" });

    this.messages.push({
      role: "tool",
      content,
      toolResults: [result],
    });

    this.pendingToolCalls = this.pendingToolCalls.filter((call) => call.id !== result.id);
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.pendingToolCalls = [];
  }

  getMessagesForAPI(apiType: APIType): unknown[] {
    switch (apiType) {
      case "openai":
        return this.buildOpenAIMessages();
      case "anthropic":
        return this.buildAnthropicMessages();
      case "gemini":
        return this.buildGeminiMessages();
      default:
        return this.buildOpenAIMessages();
    }
  }

  hasPendingToolCalls(): boolean {
    return this.pendingToolCalls.length > 0;
  }

  getPendingToolCalls(): ToolCallRequest[] {
    return [...this.pendingToolCalls];
  }

  private buildOpenAIMessages(): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];

    for (const message of this.messages) {
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

  private buildAnthropicMessages(): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];

    for (const message of this.messages) {
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

  private buildGeminiMessages(): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];

    for (const message of this.messages) {
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
}
