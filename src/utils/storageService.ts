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

export interface AIProfile extends AISettings {
  id: string;
  name: string;
}

export interface AISettingsStore {
  version: number;
  activeProfileId: string;
  profiles: AIProfile[];
}

const SETTINGS_KEY = "writebot_ai_settings";
const SETTINGS_VERSION = 2;
const DEFAULT_PROFILE_NAME = "默认配置";

const API_DEFAULTS: Record<APIType, Pick<AISettings, "apiEndpoint" | "model">> = {
  openai: {
    apiEndpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  anthropic: {
    apiEndpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-3-5-sonnet-20241022",
  },
  gemini: {
    apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    model: "gemini-1.5-pro",
  },
};

const defaultSettings: AISettings = {
  apiType: "openai",
  apiKey: "",
  ...API_DEFAULTS.openai,
};

const API_TYPES: APIType[] = ["openai", "anthropic", "gemini"];

function isAPIType(value: unknown): value is APIType {
  return API_TYPES.includes(value as APIType);
}

function generateProfileId(): string {
  return `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProfile(
  profile: Partial<AIProfile>,
  index: number,
  fallbackName?: string
): AIProfile {
  const apiType = isAPIType(profile.apiType) ? profile.apiType : defaultSettings.apiType;
  const nameCandidate = typeof profile.name === "string" ? profile.name.trim() : "";
  const name = nameCandidate || fallbackName || `配置 ${index + 1}`;
  const idCandidate = typeof profile.id === "string" ? profile.id.trim() : "";
  const id = idCandidate || generateProfileId();

  const base: AIProfile = {
    id,
    name,
    apiType,
    apiKey: typeof profile.apiKey === "string" ? profile.apiKey : "",
    apiEndpoint: typeof profile.apiEndpoint === "string" ? profile.apiEndpoint : "",
    model: typeof profile.model === "string" ? profile.model : "",
  };

  const normalized = applyApiDefaults(base);
  return { ...base, ...normalized };
}

function buildDefaultProfile(name?: string): AIProfile {
  return normalizeProfile({ ...defaultSettings, name: name || DEFAULT_PROFILE_NAME }, 0, name);
}


/**
 * 获取指定 API 类型的默认端点与模型
 */
export function getApiDefaults(apiType: APIType): Pick<AISettings, "apiEndpoint" | "model"> {
  return { ...API_DEFAULTS[apiType] };
}

/**
 * 规范化设置：按 API 类型补齐缺失的 endpoint / model
 */
export function applyApiDefaults(settings: AISettings): AISettings {
  const defaults = getApiDefaults(settings.apiType);
  return {
    ...settings,
    apiEndpoint: settings.apiEndpoint?.trim() ? settings.apiEndpoint : defaults.apiEndpoint,
    model: settings.model?.trim() ? settings.model : defaults.model,
  };
}

/**
 * 获取设置缺失项提示
 */
export function getAISettingsValidationError(settings: AISettings): string | null {
  const missing: string[] = [];
  if (!settings.apiKey?.trim()) missing.push("API 密钥");
  if (!settings.apiEndpoint?.trim()) missing.push("API 端点");
  if (!settings.model?.trim()) missing.push("模型名称");

  if (missing.length === 0) return null;
  return `请先在设置中填写：${missing.join("、")}`;
}

/**
 * 保存 AI 设置到 localStorage（仅本地存储）
 */
export async function saveSettings(settings: AISettings): Promise<void> {
  try {
    const store = loadSettingsStore();
    const activeId = store.activeProfileId;
    const profiles = store.profiles.map((profile, index) => {
      if (profile.id !== activeId) return profile;
      return normalizeProfile({ ...profile, ...settings }, index, profile.name);
    });
    await saveSettingsStore({
      version: SETTINGS_VERSION,
      activeProfileId: activeId,
      profiles,
    });
  } catch (e) {
    throw new Error("保存设置失败");
  }
}

/**
 * 从 localStorage 加载 AI 设置
 */
export function loadSettings(): AISettings {
  const store = loadSettingsStore();
  const active = store.profiles.find((profile) => profile.id === store.activeProfileId)
    || store.profiles[0];
  if (!active) {
    return { ...defaultSettings };
  }
  return applyApiDefaults({
    apiType: active.apiType,
    apiKey: active.apiKey,
    apiEndpoint: active.apiEndpoint,
    model: active.model,
  });
}

/**
 * 创建新配置
 */
export function createProfile(name?: string, overrides?: Partial<AISettings>): AIProfile {
  return normalizeProfile({ ...defaultSettings, ...overrides, name: name || DEFAULT_PROFILE_NAME }, 0, name);
}

/**
 * 加载全部配置
 */
export function loadSettingsStore(): AISettingsStore {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (parsed && Array.isArray(parsed.profiles)) {
        const profiles = parsed.profiles.map((profile, index) =>
          normalizeProfile(profile as Partial<AIProfile>, index)
        );
        const fallbackProfile = profiles[0] || buildDefaultProfile();
        const activeId = typeof parsed.activeProfileId === "string"
          ? parsed.activeProfileId
          : fallbackProfile.id;
        const resolvedActiveId = profiles.some((profile) => profile.id === activeId)
          ? activeId
          : fallbackProfile.id;
        return {
          version: SETTINGS_VERSION,
          activeProfileId: resolvedActiveId,
          profiles: profiles.length > 0 ? profiles : [fallbackProfile],
        };
      }

      if (parsed && ("apiType" in parsed || "apiKey" in parsed || "apiEndpoint" in parsed || "model" in parsed)) {
        const legacy = normalizeProfile(
          { ...(parsed as Partial<AIProfile>), name: DEFAULT_PROFILE_NAME },
          0,
          DEFAULT_PROFILE_NAME
        );
        return {
          version: SETTINGS_VERSION,
          activeProfileId: legacy.id,
          profiles: [legacy],
        };
      }
    }
  } catch {
    // 忽略错误
  }

  const fallback = buildDefaultProfile();
  return {
    version: SETTINGS_VERSION,
    activeProfileId: fallback.id,
    profiles: [fallback],
  };
}

/**
 * 保存全部配置到 localStorage
 */
export async function saveSettingsStore(store: AISettingsStore): Promise<void> {
  try {
    const inputProfiles = Array.isArray(store?.profiles) ? store.profiles : [];
    const normalizedProfiles = inputProfiles.map((profile, index) =>
      normalizeProfile(profile, index)
    );
    const profiles = normalizedProfiles.length > 0 ? normalizedProfiles : [buildDefaultProfile()];
    const activeId = typeof store?.activeProfileId === "string" && profiles.some((profile) => profile.id === store.activeProfileId)
      ? store.activeProfileId
      : profiles[0].id;

    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        activeProfileId: activeId,
        profiles,
      })
    );
  } catch (e) {
    throw new Error("保存设置失败");
  }
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
export async function saveContextMenuResult(result: ContextMenuResult): Promise<void> {
  try {
    const payload = JSON.stringify(result);
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      await OfficeRuntime.storage.setItem(CONTEXT_MENU_RESULT_KEY, payload);
    } else {
      localStorage.setItem(CONTEXT_MENU_RESULT_KEY, payload);
      // 触发 storage 事件以通知其他窗口
      window.dispatchEvent(new StorageEvent("storage", {
        key: CONTEXT_MENU_RESULT_KEY,
        newValue: payload,
      }));
    }
  } catch (e) {
    console.error("保存右键菜单结果失败:", e);
  }
}

/**
 * 获取并清除右键菜单操作结果
 */
export async function getAndClearContextMenuResult(): Promise<ContextMenuResult | null> {
  try {
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      const stored = await OfficeRuntime.storage.getItem(CONTEXT_MENU_RESULT_KEY);
      if (stored) {
        await OfficeRuntime.storage.removeItem(CONTEXT_MENU_RESULT_KEY);
        return JSON.parse(stored);
      }
      return null;
    }

    const stored = localStorage.getItem(CONTEXT_MENU_RESULT_KEY);
    if (stored) {
      localStorage.removeItem(CONTEXT_MENU_RESULT_KEY);
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
