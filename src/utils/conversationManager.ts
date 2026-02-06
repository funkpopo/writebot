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

  hasPendingToolCalls(): boolean {
    return this.pendingToolCalls.length > 0;
  }

  getPendingToolCalls(): ToolCallRequest[] {
    return [...this.pendingToolCalls];
  }
}
