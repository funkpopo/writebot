/**
 * AI configuration management.
 * Holds the mutable module-level `config` state and related functions.
 */

import {
  AISettings,
  applyApiDefaults,
  getDefaultSettings,
  getApiDefaults,
  getAISettingsValidationError,
} from "../storageService";
import { normalizeMaxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS } from "../tokenUtils";

// 默认配置（需要用户配置实际的 API 密钥）
const defaultConfig: AISettings = getDefaultSettings();

let config: AISettings = { ...defaultConfig };

export function getMaxOutputTokens(): number {
  // 用户如需更小的输出上限，可通过配置覆盖；否则统一使用默认值 65535。
  return normalizeMaxOutputTokens(config.maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

export function assertAIConfig(): void {
  const error = getAISettingsValidationError(config);
  if (error) {
    throw new Error(error);
  }
}

/**
 * 设置 AI 配置
 */
export function setAIConfig(newConfig: Partial<AISettings>): void {
  const nextType = newConfig.apiType ?? config.apiType;
  const merged = { ...config, ...newConfig, apiType: nextType } as AISettings;

  if (newConfig.apiType && newConfig.apiType !== config.apiType) {
    const defaults = getApiDefaults(nextType);
    merged.apiEndpoint = newConfig.apiEndpoint?.trim()
      ? newConfig.apiEndpoint
      : defaults.apiEndpoint;
    merged.model = newConfig.model?.trim()
      ? newConfig.model
      : defaults.model;
  }

  merged.maxOutputTokens = normalizeMaxOutputTokens(merged.maxOutputTokens);
  config = applyApiDefaults(merged);
}

/**
 * 获取当前配置
 */
export function getAIConfig(): AISettings {
  return { ...config };
}

/**
 * 获取内部 config 引用（供 provider 模块读取 apiKey / apiEndpoint / model 等）
 */
export function getConfigRef(): AISettings {
  return config;
}

/**
 * 检查 API 是否已配置
 */
export function isAPIConfigured(): boolean {
  return !getAISettingsValidationError(config);
}

/**
 * 获取当前配置的校验错误信息
 */
export function getAIConfigValidationError(): string | null {
  return getAISettingsValidationError(config);
}
