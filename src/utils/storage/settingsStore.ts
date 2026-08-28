/**
 * AI 设置存储 - 多 Profile 配置、系统代理配置
 * 优先通过本地服务的受保护存储持久化，服务不可用时回退 localStorage。
 */

import { normalizeMaxOutputTokens } from "../tokenUtils";
import { encryptString, decryptString } from "../crypto";
import { buildLocalServiceUrl, withLocalServiceHeaders } from "../localServiceClient";
import { AGENT_PERMISSION_MODE_KEY } from "./agentPermissionStore";

export type APIType = "openai" | "anthropic" | "gemini";
export type SystemProxyProtocol = "http" | "socks5";

export interface AgentRoleConfig {
  model?: string;
  temperature?: number;
}

export interface AISettings {
  apiType: APIType;
  apiKey: string;
  apiEndpoint: string;
  model: string;
  /** 是否强制通过本地服务转发模型请求（由全局系统代理配置派生） */
  forceLocalProxy?: boolean;
  /** 单次请求的超时时间（毫秒），默认 90000 */
  requestTimeoutMs?: number;
  /** 模型的最大输出 token 数（用于请求的 max_tokens，默认 65535） */
  maxOutputTokens?: number;
  /** Planner 专用模型（留空则跟随主模型） */
  plannerModel?: string;
  plannerTemperature?: number;
  /** Writer 专用模型（留空则跟随主模型） */
  writerModel?: string;
  writerTemperature?: number;
  /** 并行章节生成并发数（1-6，默认 3） */
  parallelSectionConcurrency?: number;
}

export interface AIProfile extends AISettings {
  id: string;
  name: string;
}

export interface SystemProxySettings {
  enabled: boolean;
  protocol: SystemProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface AISettingsStore {
  version: number;
  activeProfileId: string;
  profiles: AIProfile[];
  systemProxy: SystemProxySettings;
}

export interface RibbonCommandRequest {
  id: string;
  action: string;
  inputText: string;
  timestamp: string;
}

const SETTINGS_KEY = "writebot_ai_settings";
const SETTINGS_VERSION = 3;
const DEFAULT_PROFILE_NAME = "默认配置";
const SETTINGS_STORE_API = buildLocalServiceUrl("/api/settings-store");

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
const SYSTEM_PROXY_PROTOCOLS: SystemProxyProtocol[] = ["http", "socks5"];
const DEFAULT_PARALLEL_SECTION_CONCURRENCY = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_SYSTEM_PROXY_PORTS: Record<SystemProxyProtocol, number> = {
  http: 8080,
  socks5: 1080,
};

const defaultSettings: AISettings = {
  apiType: "openai",
  apiKey: "",
  ...API_DEFAULTS.openai,
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  parallelSectionConcurrency: DEFAULT_PARALLEL_SECTION_CONCURRENCY,
};

const DEFAULT_SYSTEM_PROXY_SETTINGS: SystemProxySettings = {
  enabled: false,
  protocol: "http",
  host: "",
  port: DEFAULT_SYSTEM_PROXY_PORTS.http,
  username: "",
  password: "",
};

function isAPIType(value: unknown): value is APIType {
  return API_TYPES.includes(value as APIType);
}

function isSystemProxyProtocol(value: unknown): value is SystemProxyProtocol {
  return SYSTEM_PROXY_PROTOCOLS.includes(value as SystemProxyProtocol);
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

export function normalizeRequestTimeoutMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return Math.min(300_000, Math.max(5_000, normalized));
}

function normalizeSystemProxyHost(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\[|\]$/g, "");
}

function normalizeSystemProxyPort(value: unknown, protocol: SystemProxyProtocol): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SYSTEM_PROXY_PORTS[protocol];
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SYSTEM_PROXY_PORTS[protocol];
  }
  const normalized = Math.floor(parsed);
  if (normalized < 1 || normalized > 65535) {
    return DEFAULT_SYSTEM_PROXY_PORTS[protocol];
  }
  return normalized;
}

function normalizeOptionalProxyCredential(value: unknown, trim = true): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = trim ? value.trim() : value;
  return normalized || undefined;
}

export function normalizeSystemProxySettings(value: unknown): SystemProxySettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SYSTEM_PROXY_SETTINGS };
  }

  const record = value as Record<string, unknown>;
  const protocol = isSystemProxyProtocol(record.protocol) ? record.protocol : DEFAULT_SYSTEM_PROXY_SETTINGS.protocol;

  return {
    enabled: record.enabled === true,
    protocol,
    host: normalizeSystemProxyHost(record.host),
    port: normalizeSystemProxyPort(record.port, protocol),
    username: normalizeOptionalProxyCredential(record.username),
    password: normalizeOptionalProxyCredential(record.password, false),
  };
}

export function getDefaultSystemProxyPort(protocol: SystemProxyProtocol): number {
  return DEFAULT_SYSTEM_PROXY_PORTS[protocol];
}

export function getDefaultSystemProxySettings(): SystemProxySettings {
  return { ...DEFAULT_SYSTEM_PROXY_SETTINGS };
}

export function getSystemProxyValidationError(settings: SystemProxySettings): string | null {
  if (!settings.enabled) {
    return null;
  }

  const host = normalizeSystemProxyHost(settings.host);
  if (!host) {
    return "启用系统代理前请填写代理主机";
  }

  if (/:\/\//.test(host) || /[\/?#]/.test(host) || host.includes("@")) {
    return "代理主机仅填写主机名或 IP，不要包含协议、路径或账号信息";
  }

  const port = normalizeSystemProxyPort(settings.port, settings.protocol);
  if (port < 1 || port > 65535) {
    return "代理端口必须在 1-65535 之间";
  }

  return null;
}

export function hasConfiguredSystemProxy(settings: SystemProxySettings | undefined): boolean {
  if (!settings) return false;
  const normalized = normalizeSystemProxySettings(settings);
  return normalized.enabled && getSystemProxyValidationError(normalized) === null;
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
    requestTimeoutMs:
      normalizeRequestTimeoutMs(profile.requestTimeoutMs)
      ?? DEFAULT_REQUEST_TIMEOUT_MS,
    // Some OpenAI-compatible servers return absurd sentinel values (e.g. 999999999) for "unlimited".
    // Treat them as unknown so we don't persist a misleading value or break requests.
    maxOutputTokens: normalizeMaxOutputTokens(profile.maxOutputTokens),
    plannerModel: normalizeRoleModel(profile.plannerModel),
    plannerTemperature: normalizeTemperature(profile.plannerTemperature),
    writerModel: normalizeRoleModel(profile.writerModel),
    writerTemperature: normalizeTemperature(profile.writerTemperature),
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

function normalizeSettingsStore(store?: Partial<AISettingsStore>): AISettingsStore {
  const inputProfiles = Array.isArray(store?.profiles) ? store.profiles : [];
  const normalizedProfiles = inputProfiles.map((profile, index) =>
    normalizeProfile(profile, index)
  );
  const profiles = normalizedProfiles.length > 0 ? normalizedProfiles : [buildDefaultProfile()];
  const activeId =
    typeof store?.activeProfileId === "string"
    && profiles.some((profile) => profile.id === store.activeProfileId)
      ? store.activeProfileId
      : profiles[0]!.id;

  return {
    version: SETTINGS_VERSION,
    activeProfileId: activeId,
    profiles,
    systemProxy: normalizeSystemProxySettings(store?.systemProxy),
  };
}

function hasLegacySettingsCache(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

type RemoteSettingsStoreLoadResult =
  | { status: "ok"; store: AISettingsStore }
  | { status: "not_found" | "unavailable" };

async function loadSettingsStoreFromService(): Promise<RemoteSettingsStoreLoadResult> {
  try {
    const response = await fetch(SETTINGS_STORE_API, {
      method: "GET",
      headers: withLocalServiceHeaders(),
      cache: "no-store",
    });

    if (response.status === 404) {
      return { status: "not_found" };
    }

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const parsed = (await response.json()) as Partial<AISettingsStore>;
    return {
      status: "ok",
      store: normalizeSettingsStore(parsed),
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function saveSettingsStoreToService(store: AISettingsStore): Promise<boolean> {
  try {
    const response = await fetch(SETTINGS_STORE_API, {
      method: "PUT",
      headers: withLocalServiceHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(normalizeSettingsStore(store)),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function clearSettingsStoreFromService(): Promise<"ok" | "unavailable" | "error"> {
  try {
    const response = await fetch(SETTINGS_STORE_API, {
      method: "DELETE",
      headers: withLocalServiceHeaders(),
    });
    if (response.ok || response.status === 404) {
      return "ok";
    }
    return "error";
  } catch {
    return "unavailable";
  }
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
 * 保存 AI 设置到本地配置存储
 */
export async function saveSettings(settings: AISettings): Promise<void> {
  try {
    const store = await loadSettingsStore();
    const activeId = store.activeProfileId;
    const profiles = store.profiles.map((profile, index) => {
      if (profile.id !== activeId) return profile;
      return normalizeProfile({ ...profile, ...settings }, index, profile.name);
    });
    await saveSettingsStore({
      version: SETTINGS_VERSION,
      activeProfileId: activeId,
      profiles,
      systemProxy: store.systemProxy,
    });
  } catch {
    throw new Error("保存设置失败");
  }
}

/**
 * 加载当前启用的 AI 设置
 */
export async function loadSettings(): Promise<AISettings> {
  const store = await loadSettingsStore();
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
    forceLocalProxy: hasConfiguredSystemProxy(store.systemProxy),
    requestTimeoutMs: active.requestTimeoutMs,
    maxOutputTokens: active.maxOutputTokens,
    plannerModel: active.plannerModel,
    plannerTemperature: active.plannerTemperature,
    writerModel: active.writerModel,
    writerTemperature: active.writerTemperature,
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
function loadLegacySettingsStoreSync(): AISettingsStore {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (parsed && Array.isArray(parsed.profiles)) {
        return normalizeSettingsStore({
          activeProfileId:
            typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : undefined,
          profiles: parsed.profiles as AIProfile[],
          systemProxy: parsed.systemProxy as SystemProxySettings | undefined,
        });
      }

      if (parsed && ("apiType" in parsed || "apiKey" in parsed || "apiEndpoint" in parsed || "model" in parsed)) {
        const legacy = normalizeProfile({ ...(parsed as Partial<AIProfile>), name: DEFAULT_PROFILE_NAME }, 0, DEFAULT_PROFILE_NAME);
        return normalizeSettingsStore({
          activeProfileId: legacy.id,
          profiles: [legacy],
        });
      }
    }
  } catch {
    // 忽略错误
  }

  return normalizeSettingsStore();
}

/**
 * 加载全部配置。
 * 优先从本地服务的受保护存储加载；服务不可用时回退到旧版 localStorage。
 */
export async function loadSettingsStore(): Promise<AISettingsStore> {
  const remoteResult = await loadSettingsStoreFromService();
  if (remoteResult.status === "ok") {
    return remoteResult.store;
  }

  const legacyStore = await decryptProfileKeys(loadLegacySettingsStoreSync());
  if (remoteResult.status === "not_found" && hasLegacySettingsCache()) {
    const migrated = await saveSettingsStoreToService(legacyStore);
    if (migrated) {
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch {
        // ignore legacy cache cleanup failure
      }
    }
  }

  return legacyStore;
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
  return {
    ...store,
    profiles: decryptedProfiles,
    systemProxy: {
      ...store.systemProxy,
      password: await decryptString(store.systemProxy?.password || ""),
    },
  };
}

/**
 * 保存全部配置到 localStorage
 * API keys are encrypted before persisting.
 */
export async function saveSettingsStore(store: AISettingsStore): Promise<void> {
  try {
    const normalizedStore = normalizeSettingsStore(store);
    const savedToService = await saveSettingsStoreToService(normalizedStore);
    if (savedToService) {
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch {
        // ignore best-effort cleanup failure
      }
      return;
    }

    // Fallback for dev mode or service-unavailable environments.
    const encryptedProfiles = await Promise.all(
      normalizedStore.profiles.map(async (profile) => ({
        ...profile,
        apiKey: await encryptString(profile.apiKey),
      }))
    );

    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        activeProfileId: normalizedStore.activeProfileId,
        profiles: encryptedProfiles,
        systemProxy: {
          ...normalizedStore.systemProxy,
          password: await encryptString(normalizedStore.systemProxy.password || ""),
        },
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
    const remoteResult = await clearSettingsStoreFromService();
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(AGENT_PERMISSION_MODE_KEY);
    if (remoteResult === "error") {
      throw new Error("清除远程设置失败");
    }
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

export function getDefaultRequestTimeoutMs(): number {
  return DEFAULT_REQUEST_TIMEOUT_MS;
}
