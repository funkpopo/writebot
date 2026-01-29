/**
 * 存储服务 - 使用 localStorage 进行本地持久化存储
 * 数据仅保存在本地浏览器中，不会上传到任何服务器
 */

export type APIType = "openai" | "anthropic" | "gemini";

export interface AISettings {
  apiType: APIType;
  apiKey: string;
  apiEndpoint: string;
  model: string;
}

const SETTINGS_KEY = "writebot_ai_settings";

const defaultSettings: AISettings = {
  apiType: "openai",
  apiKey: "",
  apiEndpoint: "",
  model: "",
};

/**
 * 保存 AI 设置到 localStorage（仅本地存储）
 */
export async function saveSettings(settings: AISettings): Promise<void> {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    throw new Error("保存设置失败");
  }
}

/**
 * 从 localStorage 加载 AI 设置
 */
export function loadSettings(): AISettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // 忽略错误
  }
  return defaultSettings;
}

/**
 * 清除保存的设置
 */
export async function clearSettings(): Promise<void> {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (e) {
    throw new Error("清除设置失败");
  }
}

/**
 * 获取默认设置
 */
export function getDefaultSettings(): AISettings {
  return { ...defaultSettings };
}

// ============ 对话记录存储 (使用 sessionStorage，关闭 Word 后自动清除) ============

const CONVERSATION_KEY = "writebot_conversation";
const CONTEXT_MENU_RESULT_KEY = "writebot_context_menu_result";

export interface StoredMessage {
  id: string;
  type: "user" | "assistant";
  content: string;
  thinking?: string;
  action?: string;
  timestamp: string; // ISO string for serialization
}

export interface ContextMenuResult {
  id: string;
  originalText: string;
  resultText: string;
  thinking?: string;
  action: string;
  timestamp: string;
}

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

/**
 * 保存右键菜单操作结果（用于跨窗口通信）
 */
export function saveContextMenuResult(result: ContextMenuResult): void {
  try {
    sessionStorage.setItem(CONTEXT_MENU_RESULT_KEY, JSON.stringify(result));
    // 触发 storage 事件以通知其他窗口
    window.dispatchEvent(new StorageEvent("storage", {
      key: CONTEXT_MENU_RESULT_KEY,
      newValue: JSON.stringify(result),
    }));
  } catch (e) {
    console.error("保存右键菜单结果失败:", e);
  }
}

/**
 * 获取并清除右键菜单操作结果
 */
export function getAndClearContextMenuResult(): ContextMenuResult | null {
  try {
    const stored = sessionStorage.getItem(CONTEXT_MENU_RESULT_KEY);
    if (stored) {
      sessionStorage.removeItem(CONTEXT_MENU_RESULT_KEY);
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("获取右键菜单结果失败:", e);
  }
  return null;
}

/**
 * 获取右键菜单结果存储键名（用于事件监听）
 */
export function getContextMenuResultKey(): string {
  return CONTEXT_MENU_RESULT_KEY;
}
