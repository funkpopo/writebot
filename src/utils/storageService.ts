/**
 * 存储服务 - 使用 localStorage 进行本地持久化存储
 * 数据仅保存在本地浏览器中，不会上传到任何服务器
 */

import { normalizeMaxOutputTokens } from "./tokenUtils";
import { encryptString, decryptString } from "./crypto";
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  normalizeTranslationTargetLanguage,
  type TranslationTargetLanguage,
} from "./translationLanguages";

export type APIType = "openai" | "anthropic" | "gemini";

export interface AgentRoleConfig {
  model?: string;
  temperature?: number;
}

export interface AISettings {
  apiType: APIType;
  apiKey: string;
  apiEndpoint: string;
  model: string;
  /** 模型的最大输出 token 数（用于请求的 max_tokens，默认 65535） */
  maxOutputTokens?: number;
  /** Planner 专用模型（留空则跟随主模型） */
  plannerModel?: string;
  plannerTemperature?: number;
  /** Writer 专用模型（留空则跟随主模型） */
  writerModel?: string;
  writerTemperature?: number;
  /** Reviewer 专用模型（留空则跟随主模型） */
  reviewerModel?: string;
  reviewerTemperature?: number;
  /** 并行章节生成并发数（1-6，默认 3） */
  parallelSectionConcurrency?: number;
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

export interface ContextMenuPreferences {
  translateTargetLanguage: TranslationTargetLanguage;
}

const SETTINGS_KEY = "writebot_ai_settings";
const SETTINGS_VERSION = 2;
const CONTEXT_MENU_PREFERENCES_KEY = "writebot_context_menu_preferences";
const CONTEXT_MENU_PREFERENCES_VERSION = 1;
const DEFAULT_PROFILE_NAME = "默认配置";

const DEFAULT_CONTEXT_MENU_PREFERENCES: ContextMenuPreferences = {
  translateTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
};

const API_DEFAULTS: Record<APIType, Pick<AISettings, "apiEndpoint" | "model">> = {
  openai: {
    apiEndpoint: "https://api.openai.com/",
    model: "gpt-4o-mini",
  },
  anthropic: {
    apiEndpoint: "https://api.anthropic.com/",
    model: "claude-3-5-sonnet-20241022",
  },
  gemini: {
    apiEndpoint: "https://generativelanguage.googleapis.com/",
    model: "gemini-1.5-pro",
  },
};

const API_TYPES: APIType[] = ["openai", "anthropic", "gemini"];
const DEFAULT_PARALLEL_SECTION_CONCURRENCY = 3;

const defaultSettings: AISettings = {
  apiType: "openai",
  apiKey: "",
  ...API_DEFAULTS.openai,
  parallelSectionConcurrency: DEFAULT_PARALLEL_SECTION_CONCURRENCY,
};

function isAPIType(value: unknown): value is APIType {
  return API_TYPES.includes(value as APIType);
}

function normalizeRoleModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(2, Math.max(0, parsed));
}

function normalizeParallelSectionConcurrency(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return Math.min(6, Math.max(1, normalized));
}

function generateProfileId(): string {
  return `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProfile(
  profile: Partial<AIProfile>,
  index: number,
  fallbackName?: string
): AIProfile {
  let apiType: APIType = defaultSettings.apiType;
  let apiTypeValid = false;
  if (isAPIType(profile.apiType)) {
    apiType = profile.apiType;
    apiTypeValid = true;
  }
  const nameCandidate = typeof profile.name === "string" ? profile.name.trim() : "";
  const name = nameCandidate || fallbackName || `配置 ${index + 1}`;
  const idCandidate = typeof profile.id === "string" ? profile.id.trim() : "";
  const id = idCandidate || generateProfileId();

  const base: AIProfile = {
    id,
    name,
    apiType,
    apiKey: typeof profile.apiKey === "string" ? profile.apiKey : "",
    // If a stored profile contains an unsupported apiType,
    // do NOT keep its endpoint/model; otherwise we may end up with a mismatched endpoint.
    apiEndpoint: apiTypeValid && typeof profile.apiEndpoint === "string" ? profile.apiEndpoint : "",
    model: apiTypeValid && typeof profile.model === "string" ? profile.model : "",
    // Some OpenAI-compatible servers return absurd sentinel values (e.g. 999999999) for "unlimited".
    // Treat them as unknown so we don't persist a misleading value or break requests.
    maxOutputTokens: normalizeMaxOutputTokens(profile.maxOutputTokens),
    plannerModel: normalizeRoleModel(profile.plannerModel),
    plannerTemperature: normalizeTemperature(profile.plannerTemperature),
    writerModel: normalizeRoleModel(profile.writerModel),
    writerTemperature: normalizeTemperature(profile.writerTemperature),
    reviewerModel: normalizeRoleModel(profile.reviewerModel),
    reviewerTemperature: normalizeTemperature(profile.reviewerTemperature),
    parallelSectionConcurrency:
      normalizeParallelSectionConcurrency(profile.parallelSectionConcurrency)
      ?? DEFAULT_PARALLEL_SECTION_CONCURRENCY,
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
    const store = await decryptProfileKeys(loadSettingsStore());
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
  } catch {
    throw new Error("保存设置失败");
  }
}

/**
 * 从 localStorage 加载 AI 设置（异步，会解密 API 密钥）
 */
export async function loadSettings(): Promise<AISettings> {
  const store = loadSettingsStore();
  const active = store.profiles.find((profile) => profile.id === store.activeProfileId)
    || store.profiles[0];
  if (!active) {
    return { ...defaultSettings };
  }
  return applyApiDefaults({
    apiType: active.apiType,
    apiKey: await decryptString(active.apiKey),
    apiEndpoint: active.apiEndpoint,
    model: active.model,
    maxOutputTokens: active.maxOutputTokens,
    plannerModel: active.plannerModel,
    plannerTemperature: active.plannerTemperature,
    writerModel: active.writerModel,
    writerTemperature: active.writerTemperature,
    reviewerModel: active.reviewerModel,
    reviewerTemperature: active.reviewerTemperature,
    parallelSectionConcurrency: active.parallelSectionConcurrency,
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
 * Decrypt API keys in a settings store.
 * Use this after loadSettingsStore() when you need plaintext API keys
 * (e.g. in the Settings UI or before making API calls).
 */
export async function decryptProfileKeys(store: AISettingsStore): Promise<AISettingsStore> {
  const decryptedProfiles = await Promise.all(
    store.profiles.map(async (profile) => ({
      ...profile,
      apiKey: await decryptString(profile.apiKey),
    }))
  );
  return { ...store, profiles: decryptedProfiles };
}

/**
 * 保存全部配置到 localStorage
 * API keys are encrypted before persisting.
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

    // Encrypt API keys before writing to localStorage
    const encryptedProfiles = await Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        apiKey: await encryptString(profile.apiKey),
      }))
    );

    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        activeProfileId: activeId,
        profiles: encryptedProfiles,
      })
    );
  } catch {
    throw new Error("保存设置失败");
  }
}

/**
 * 清除保存的设置
 */
export async function clearSettings(): Promise<void> {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(CONTEXT_MENU_PREFERENCES_KEY);
  } catch {
    throw new Error("清除设置失败");
  }
}

/**
 * 获取默认设置
 */
export function getDefaultSettings(): AISettings {
  return { ...defaultSettings };
}

export function getDefaultParallelSectionConcurrency(): number {
  return DEFAULT_PARALLEL_SECTION_CONCURRENCY;
}

function normalizeContextMenuPreferences(value: unknown): ContextMenuPreferences {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CONTEXT_MENU_PREFERENCES };
  }

  const record = value as Record<string, unknown>;
  return {
    translateTargetLanguage: normalizeTranslationTargetLanguage(record.translateTargetLanguage),
  };
}

export function getDefaultContextMenuPreferences(): ContextMenuPreferences {
  return { ...DEFAULT_CONTEXT_MENU_PREFERENCES };
}

export function loadContextMenuPreferences(): ContextMenuPreferences {
  try {
    const raw = localStorage.getItem(CONTEXT_MENU_PREFERENCES_KEY);
    if (!raw) return getDefaultContextMenuPreferences();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeContextMenuPreferences(parsed);
  } catch {
    return getDefaultContextMenuPreferences();
  }
}

export async function saveContextMenuPreferences(
  preferences: ContextMenuPreferences
): Promise<void> {
  try {
    const normalized = normalizeContextMenuPreferences(preferences);
    localStorage.setItem(
      CONTEXT_MENU_PREFERENCES_KEY,
      JSON.stringify({
        version: CONTEXT_MENU_PREFERENCES_VERSION,
        ...normalized,
      })
    );
  } catch {
    throw new Error("保存右键菜单偏好失败");
  }
}


// ============ 对话记录存储 (使用 sessionStorage，关闭 Word 后自动清除) ============

const CONVERSATION_KEY = "writebot_conversation";
const CONTEXT_MENU_RESULT_KEY = "writebot_context_menu_result";
const AGENT_PLAN_KEY = "writebot_agent_plan_md";
const AGENT_PLAN_API = "https://localhost:53000/api/plan";
const AGENT_MEMORY_KEY = "writebot_agent_memory_md";
const AGENT_MEMORY_API = "https://localhost:53000/api/memory";

export interface StoredMessage {
  id: string;
  type: "user" | "assistant";
  content: string;
  plainText?: string;
  thinking?: string;
  action?: string;
  /**
   * UI-only message (do not feed back into the AI conversation context).
   * Used for agent tool output previews / execution logs.
   */
  uiOnly?: boolean;
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

export interface AgentPlanFile {
  fileName: "plan.md";
  path: string;
  content: string;
  request: string;
  stageCount: number;
  updatedAt: string;
}

export interface AgentMemoryFile {
  fileName: "memory.md";
  path: string;
  content: string;
  updatedAt: string;
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

export function getAgentPlanPath(): string {
  return AGENT_PLAN_API;
}

function normalizeAgentMemoryFile(value: Partial<AgentMemoryFile>): AgentMemoryFile | null {
  if (!value || typeof value.content !== "string") {
    return null;
  }
  const normalizedPath = typeof value.path === "string" && value.path.trim()
    ? value.path
    : AGENT_MEMORY_API;
  return {
    fileName: "memory.md",
    path: normalizedPath,
    content: value.content,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt
        : new Date().toISOString(),
  };
}

function loadAgentMemoryFromCache(): AgentMemoryFile | null {
  try {
    const cached = localStorage.getItem(AGENT_MEMORY_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as Partial<AgentMemoryFile>;
    return normalizeAgentMemoryFile(parsed);
  } catch {
    return null;
  }
}

export async function saveAgentPlan(params: {
  content: string;
  request: string;
  stageCount: number;
}): Promise<AgentPlanFile> {
  const file: AgentPlanFile = {
    fileName: "plan.md",
    path: AGENT_PLAN_API,
    content: params.content,
    request: params.request,
    stageCount: params.stageCount,
    updatedAt: new Date().toISOString(),
  };

  try {
    await fetch(AGENT_PLAN_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    });
  } catch (e) {
    console.error("保存 Agent plan.md 到服务端失败:", e);
  }

  // 同步写入 localStorage 作为运行时缓存（不作为持久化来源）
  try {
    localStorage.setItem(AGENT_PLAN_KEY, JSON.stringify(file));
  } catch { /* ignore */ }

  return file;
}

export async function loadAgentPlan(): Promise<AgentPlanFile | null> {
  try {
    const res = await fetch(AGENT_PLAN_API);
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AgentPlanFile>;
      if (parsed && typeof parsed.content === "string") {
        return {
          fileName: "plan.md",
          path: AGENT_PLAN_API,
          content: parsed.content,
          request: typeof parsed.request === "string" ? parsed.request : "",
          stageCount:
            typeof parsed.stageCount === "number" && Number.isFinite(parsed.stageCount)
              ? Math.max(1, Math.floor(parsed.stageCount))
              : 1,
          updatedAt:
            typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
              ? parsed.updatedAt
              : new Date().toISOString(),
        };
      }
    }
  } catch (e) {
    console.error("从服务端加载 Agent plan.md 失败:", e);
  }
  return null;
}

export async function clearAgentPlan(): Promise<void> {
  try {
    await fetch(AGENT_PLAN_API, { method: "DELETE" });
  } catch (e) {
    console.error("从服务端清除 Agent plan.md 失败:", e);
  }
  try {
    localStorage.removeItem(AGENT_PLAN_KEY);
  } catch { /* ignore */ }
}

export function getAgentMemoryPath(): string {
  return AGENT_MEMORY_API;
}

export async function saveAgentMemory(params: {
  content: string;
}): Promise<AgentMemoryFile> {
  const file: AgentMemoryFile = {
    fileName: "memory.md",
    path: AGENT_MEMORY_API,
    content: params.content,
    updatedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(AGENT_MEMORY_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    });
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AgentMemoryFile>;
      if (typeof parsed.path === "string" && parsed.path.trim()) {
        file.path = parsed.path;
      }
      if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
        file.updatedAt = parsed.updatedAt;
      }
    }
  } catch (e) {
    console.error("保存 Agent memory.md 到服务端失败:", e);
  }

  try {
    localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(file));
  } catch { /* ignore */ }

  return file;
}

export async function loadAgentMemory(): Promise<AgentMemoryFile | null> {
  try {
    const res = await fetch(AGENT_MEMORY_API);
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AgentMemoryFile>;
      const normalized = normalizeAgentMemoryFile(parsed);
      if (normalized) {
        try {
          localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(normalized));
        } catch { /* ignore */ }
        return normalized;
      }
    }
  } catch (e) {
    console.error("从服务端加载 Agent memory.md 失败:", e);
  }
  return loadAgentMemoryFromCache();
}

export async function clearAgentMemory(): Promise<void> {
  try {
    await fetch(AGENT_MEMORY_API, { method: "DELETE" });
  } catch (e) {
    console.error("从服务端清除 Agent memory.md 失败:", e);
  }
  try {
    localStorage.removeItem(AGENT_MEMORY_KEY);
  } catch { /* ignore */ }
}
