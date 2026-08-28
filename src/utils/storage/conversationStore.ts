/**
 * 对话记录存储 (使用 sessionStorage，关闭 Word 后自动清除)
 */

export interface StoredMessage {
  id: string;
  type: "user" | "assistant";
  content: string;
  plainText?: string;
  applyContent?: string;
  thinking?: string;
  action?: string;
  actionLabel?: string;
  /**
   * UI-only message (do not feed back into the AI conversation context).
   * Used for agent tool output previews / execution logs.
   */
  uiOnly?: boolean;
  timestamp: string; // ISO string for serialization
}

const CONVERSATION_KEY = "writebot_conversation";

/**
 * 保存对话记录到 sessionStorage
 */
export function saveConversation(messages: StoredMessage[]): void {
  try {
    sessionStorage.setItem(CONVERSATION_KEY, JSON.stringify(messages));
  } catch (e) {
    console.error("保存对话记录失败:", e);
  }
}

/**
 * 从 sessionStorage 加载对话记录
 */
export function loadConversation(): StoredMessage[] {
  try {
    const stored = sessionStorage.getItem(CONVERSATION_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("加载对话记录失败:", e);
  }
  return [];
}

/**
 * 清除对话记录
 */
export function clearConversation(): void {
  try {
    sessionStorage.removeItem(CONVERSATION_KEY);
  } catch (e) {
    console.error("清除对话记录失败:", e);
  }
}
