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
