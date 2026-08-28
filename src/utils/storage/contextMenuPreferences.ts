/**
 * 右键菜单偏好设置存储（localStorage）
 */

import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  normalizeTranslationTargetLanguage,
  type TranslationTargetLanguage,
} from "../translationLanguages";

export interface ContextMenuPreferences {
  translateTargetLanguage: TranslationTargetLanguage;
}

export const CONTEXT_MENU_PREFERENCES_KEY = "writebot_context_menu_preferences";
const CONTEXT_MENU_PREFERENCES_VERSION = 1;

const DEFAULT_CONTEXT_MENU_PREFERENCES: ContextMenuPreferences = {
  translateTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
};

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
