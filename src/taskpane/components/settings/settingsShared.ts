import {
  getDefaultParallelSectionConcurrency,
  getDefaultRequestTimeoutMs,
  getDefaultSystemProxyPort,
  hasConfiguredSystemProxy,
  AIProfile,
  APIType,
  AISettingsStore,
  SystemProxyProtocol,
} from "../../../utils/storageService";
import { setAIConfig } from "../../../utils/ai/config";
import type { AssistantSimpleBehavior } from "../../../utils/assistantModuleService";

// ── 选项常量（原样拆自 Settings.tsx）────────────────────────
export const apiTypeOptions: { value: APIType; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

// API 端点格式示例
export const endpointExamples: Record<APIType, string> = {
  openai: "https://api.openai.com/",
  anthropic: "https://api.anthropic.com/",
  gemini: "https://generativelanguage.googleapis.com/",
};

// 模型名称示例
export const modelExamples: Record<APIType, string> = {
  openai: "gpt-4o-mini, gpt-4.5-preview, gpt-4.5-preview-02-21",
  anthropic: "claude-4-5-haiku, claude-4-5-sonnet-20250219, claude-4-5-opus-20250219",
  gemini: "gemini-3-pro-preview, gemini-3-flash-preview",
};

export const DEFAULT_PARALLEL_SECTIONS = getDefaultParallelSectionConcurrency();
export const DEFAULT_REQUEST_TIMEOUT_MS = getDefaultRequestTimeoutMs();
export const DEFAULT_HTTP_PROXY_PORT = getDefaultSystemProxyPort("http");
export const DEFAULT_SOCKS5_PROXY_PORT = getDefaultSystemProxyPort("socks5");

export const systemProxyTypeOptions: { value: SystemProxyProtocol; label: string }[] = [
  { value: "http", label: "HTTP" },
  { value: "socks5", label: "SOCKS5" },
];

export const customModuleBehaviorOptions: { value: AssistantSimpleBehavior; label: string }[] = [
  { value: "basic", label: "文本处理" },
  { value: "translation", label: "翻译" },
  { value: "style", label: "风格模板" },
];

export function syncActiveProfileToAIConfig(store: AISettingsStore) {
  const active = store.profiles.find((profile) => profile.id === store.activeProfileId)
    || store.profiles[0];
  if (!active) {
    return;
  }

  setAIConfig({
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

export function getProfileDisplayName(profile?: AIProfile | null, fallbackName = "未选择"): string {
  return profile?.model?.trim() || profile?.name?.trim() || fallbackName;
}

// ── 组件内原为闭包的纯函数（原样上提）──────────────────────
export const getApiTypeLabel = (value: APIType) => {
  const option = apiTypeOptions.find((o) => o.value === value);
  return option?.label || value;
};

export const parseOptionalFloat = (rawValue: string): number | undefined => {
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseOptionalInt = (rawValue: string): number | undefined => {
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const confirmAction = (
  messageText: string,
  options?: { defaultWhenUnavailable?: boolean }
): boolean => {
  try {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(messageText);
    }
  } catch (error) {
    console.warn("当前环境不支持确认弹窗，已使用默认确认结果。", error);
  }

  return options?.defaultWhenUnavailable ?? true;
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return "未检测到";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

export interface OfficeHostSummary {
  host: string;
  platform: string;
  version: string;
  language: string;
}

export const getOfficeHostSummary = (): OfficeHostSummary => {
  const normalizeText = (value: unknown) => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  };

  const officeContext = (globalThis as typeof globalThis & {
    Office?: {
      context?: {
        diagnostics?: {
          host?: unknown;
          platform?: unknown;
          version?: unknown;
        };
        displayLanguage?: string;
      };
    };
  }).Office?.context;
  const diagnostics = officeContext?.diagnostics;
  const platformCandidate = diagnostics?.platform;
  const versionCandidate = diagnostics?.version;

  return {
    host: normalizeText(diagnostics?.host) || "Word",
    platform: normalizeText(platformCandidate) || navigator.platform || "unknown",
    version: normalizeText(versionCandidate) || "未知",
    language: officeContext?.displayLanguage || navigator.language || "未知",
  };
};

export const getProbeValidationError = (profile: AIProfile) => {
  const missing: string[] = [];
  if (!profile.apiKey?.trim()) missing.push("API 密钥");
  if (!profile.apiEndpoint?.trim()) missing.push("API 端点");
  return missing.length > 0 ? `请先填写：${missing.join("、")}` : null;
};
