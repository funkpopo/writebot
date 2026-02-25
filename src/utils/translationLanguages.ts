export type TranslationLanguageCode =
  | 'zh-Hans'
  | 'zh-Hant'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'pt'
  | 'it'
  | 'ar'
  | 'hi'
  | 'th'
  | 'vi'
  | 'id'
  | 'tr';

export type TranslationSourceLanguage = 'auto' | TranslationLanguageCode;
export type TranslationTargetLanguage = 'auto_opposite' | TranslationLanguageCode;
export type FixedTranslationTargetLanguage = Exclude<TranslationTargetLanguage, 'auto_opposite'>;

export interface TranslationOption<TCode extends string> {
  code: TCode;
  label: string;
}

export interface TranslationRequestOptions {
  sourceLanguage?: TranslationSourceLanguage;
  targetLanguage?: TranslationTargetLanguage;
}

export const DEFAULT_TRANSLATION_SOURCE_LANGUAGE: TranslationSourceLanguage = 'auto';
export const DEFAULT_TRANSLATION_TARGET_LANGUAGE: TranslationTargetLanguage = 'auto_opposite';

export const TRANSLATION_SOURCE_OPTIONS: readonly TranslationOption<TranslationSourceLanguage>[] = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh-Hans', label: '中文（简体）' },
  { code: 'zh-Hant', label: '中文（繁体）' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'hi', label: '印地语' },
  { code: 'th', label: '泰语' },
  { code: 'vi', label: '越南语' },
  { code: 'id', label: '印度尼西亚语' },
  { code: 'tr', label: '土耳其语' },
];

export const TRANSLATION_TARGET_OPTIONS: readonly TranslationOption<TranslationTargetLanguage>[] = [
  { code: 'auto_opposite', label: '智能切换（中英互译）' },
  { code: 'zh-Hans', label: '中文（简体）' },
  { code: 'zh-Hant', label: '中文（繁体）' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'hi', label: '印地语' },
  { code: 'th', label: '泰语' },
  { code: 'vi', label: '越南语' },
  { code: 'id', label: '印度尼西亚语' },
  { code: 'tr', label: '土耳其语' },
];

const SOURCE_OPTION_SET = new Set<string>(TRANSLATION_SOURCE_OPTIONS.map((option) => option.code));
const TARGET_OPTION_SET = new Set<string>(TRANSLATION_TARGET_OPTIONS.map((option) => option.code));

const SOURCE_OPTION_LABELS = new Map<string, string>(
  TRANSLATION_SOURCE_OPTIONS.map((option) => [option.code, option.label])
);

const TARGET_OPTION_LABELS = new Map<string, string>(
  TRANSLATION_TARGET_OPTIONS.map((option) => [option.code, option.label])
);

export function normalizeTranslationSourceLanguage(value: unknown): TranslationSourceLanguage {
  if (typeof value === 'string' && SOURCE_OPTION_SET.has(value)) {
    return value as TranslationSourceLanguage;
  }
  return DEFAULT_TRANSLATION_SOURCE_LANGUAGE;
}

export function normalizeTranslationTargetLanguage(value: unknown): TranslationTargetLanguage {
  if (typeof value === 'string' && TARGET_OPTION_SET.has(value)) {
    return value as TranslationTargetLanguage;
  }
  return DEFAULT_TRANSLATION_TARGET_LANGUAGE;
}

export function getTranslationSourceLabel(code: TranslationSourceLanguage): string {
  return SOURCE_OPTION_LABELS.get(code) ?? SOURCE_OPTION_LABELS.get(DEFAULT_TRANSLATION_SOURCE_LANGUAGE) ?? '自动检测';
}

export function getTranslationTargetLabel(code: TranslationTargetLanguage): string {
  return TARGET_OPTION_LABELS.get(code) ?? TARGET_OPTION_LABELS.get(DEFAULT_TRANSLATION_TARGET_LANGUAGE) ?? '智能切换（中英互译）';
}

export function isFixedTranslationTargetLanguage(
  value: TranslationTargetLanguage
): value is FixedTranslationTargetLanguage {
  return value !== 'auto_opposite';
}
