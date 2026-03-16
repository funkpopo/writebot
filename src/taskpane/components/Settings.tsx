import * as React from "react";
import { useState, useEffect } from "react";
import {
  Button,
  Input,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
  Card,
  Text,
  MessageBar,
  MessageBarBody,
  Dropdown,
  Option,
  Field,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  Save24Regular,
  Delete24Regular,
  Eye24Regular,
  EyeOff24Regular,
  Add24Regular,
} from "@fluentui/react-icons";
import {
  loadContextMenuPreferences,
  saveSettingsStore,
  saveContextMenuPreferences,
  loadSettingsStore,
  clearSettings,
  getApiDefaults,
  getDefaultParallelSectionConcurrency,
  getDefaultRequestTimeoutMs,
  getAISettingsValidationError,
  createProfile,
  AIProfile,
  APIType,
} from "../../utils/storageService";
import { setAIConfig } from "../../utils/aiService";
import { DEFAULT_MAX_OUTPUT_TOKENS, normalizeMaxOutputTokens } from "../../utils/tokenUtils";
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  TRANSLATION_TARGET_OPTIONS,
  getTranslationTargetLabel,
  type TranslationTargetLanguage,
} from "../../utils/translationLanguages";
import {
  PROMPT_DEFINITIONS,
  PromptKey,
  getPrompt,
  getDefaultPrompt,
  isPromptCustomized,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
} from "../../utils/promptService";
import { PAGE_BOTTOM_SAFE_PADDING, SPACING } from "../ui/layoutConstants";
import {
  loadRuntimeDiagnostics,
  probeAIProfileModels,
  testAIProfileConnection,
  type ConnectionTestResult,
  type ModelProbeResult,
  type RuntimeDiagnostics,
} from "../../utils/settingsDiagnostics";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    minWidth: 0,
    gap: SPACING.md,
  },
  topArea: {
    display: "flex",
    flexDirection: "column",
    gap: SPACING.md,
    flexShrink: 0,
  },
  scrollArea: {
    flex: 1,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: SPACING.lg,
    paddingBottom: PAGE_BOTTOM_SAFE_PADDING,
    minHeight: 0,
    scrollbarGutter: "stable both-edges",
    "& > *": {
      flexShrink: 0,
      minHeight: 0,
    },
  },
  tabs: {
    display: "flex",
  },
  tabList: {
    width: "100%",
    "& button": {
      flex: 1,
      minWidth: 0,
    },
  },
  actionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.md,
    flexWrap: "wrap",
    padding: "10px 12px",
    borderRadius: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    "@media (max-width: 560px)": {
      flexDirection: "column",
      alignItems: "stretch",
    },
  },
  activeHint: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    "@media (max-width: 560px)": {
      whiteSpace: "normal",
    },
  },
  actionButtons: {
    display: "flex",
    gap: SPACING.md,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    "@media (max-width: 560px)": {
      width: "100%",
      "& .fui-Button": {
        flex: 1,
      },
    },
  },
  profilesList: {
    display: "grid",
    gap: SPACING.lg,
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    alignItems: "start",
    "@media (max-width: 620px)": {
      gridTemplateColumns: "1fr",
    },
  },
  card: {
    borderRadius: "12px",
    boxShadow: tokens.shadow4,
    overflow: "hidden",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    maxHeight: "min(70vh, 560px)",
  },
  cardExpanded: {
    gridColumn: "1 / -1",
  },
  cardHeader: {
    padding: "10px 12px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: SPACING.md,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    flexWrap: "wrap",
    flexShrink: 0,
  },
  cardHeaderInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
    flex: 1,
  },
  cardHeaderTitle: {
    fontSize: "13px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardHeaderMeta: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardHeaderStatus: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: SPACING.md,
    flexWrap: "wrap",
    flexShrink: 1,
    minWidth: 0,
    "@media (max-width: 520px)": {
      width: "100%",
      justifyContent: "space-between",
    },
  },
  activeTag: {
    fontSize: "12px",
    color: tokens.colorPaletteGreenForeground1,
  },
  errorTag: {
    fontSize: "12px",
    color: tokens.colorPaletteRedForeground1,
  },
  headerActions: {
    display: "flex",
    gap: SPACING.sm,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    "@media (max-width: 520px)": {
      width: "100%",
      "& .fui-Button": {
        flex: 1,
      },
    },
  },
  cardContent: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: SPACING.lg,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarGutter: "stable both-edges",
  },
  formGrid: {
    display: "grid",
    gap: SPACING.lg,
    alignItems: "start",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    "@media (max-width: 520px)": {
      gridTemplateColumns: "1fr",
    },
  },
  fieldSpanFull: {
    gridColumn: "1 / -1",
  },
  inputWrapper: {
    display: "flex",
    gap: SPACING.md,
    alignItems: "center",
    "@media (max-width: 480px)": {
      flexDirection: "column",
      alignItems: "stretch",
    },
  },
  input: {
    flex: 1,
    width: "100%",
    "& input": {
      borderRadius: "8px",
    },
  },
  eyeButton: {
    minWidth: "36px",
    minHeight: "36px",
    borderRadius: "8px",
    flexShrink: 0,
    "@media (max-width: 480px)": {
      width: "100%",
    },
  },
  smallButton: {
    borderRadius: "8px",
    minHeight: "32px",
  },
  hint: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  modelDropdown: {
    minWidth: "100%",
    "& button": {
      borderRadius: "8px",
    },
  },
  cardActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: SPACING.md,
    flexWrap: "wrap",
    "@media (max-width: 480px)": {
      "& .fui-Button": {
        width: "100%",
      },
    },
  },
  primaryButton: {
    borderRadius: "10px",
    minHeight: "36px",
  },
  infoCard: {
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "12px",
  },
  infoText: {
    fontSize: "13px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
  },
  infoList: {
    margin: "8px 0",
    paddingLeft: "16px",
  },
  infoListItem: {
    marginBottom: "4px",
  },
  promptMetaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.lg,
    flexWrap: "wrap",
  },
  promptTitle: {
    fontSize: "14px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  promptBadge: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  promptCard: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flex: 1,
    maxHeight: "none",
  },
  promptCardContent: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: SPACING.lg,
    minHeight: 0,
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarGutter: "stable",
  },
  promptEditorField: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flex: 1,
  },
  promptTextarea: {
    width: "100%",
    "& textarea": {
      minHeight: "220px",
      height: "min(48vh, 420px)",
      resize: "vertical",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
      fontSize: "12px",
      lineHeight: "1.5",
    },
    "@media (max-height: 640px)": {
      "& textarea": {
        minHeight: "160px",
        height: "40vh",
      },
    },
  },
  promptActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: SPACING.md,
    flexWrap: "wrap",
    "@media (max-width: 520px)": {
      "& .fui-Button": {
        flex: 1,
      },
    },
  },
  cardStatic: {
    maxHeight: "none",
  },
  diagnosticsGrid: {
    display: "grid",
    gap: SPACING.md,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    "@media (max-width: 520px)": {
      gridTemplateColumns: "1fr",
    },
  },
  diagnosticTile: {
    borderRadius: "10px",
    padding: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: 0,
  },
  diagnosticLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  diagnosticValue: {
    fontSize: "14px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    wordBreak: "break-word",
  },
  diagnosticMeta: {
    fontSize: "12px",
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground2,
    wordBreak: "break-word",
    whiteSpace: "pre-line",
  },
  diagnosticsActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: SPACING.md,
    flexWrap: "wrap",
  },
  diagnosticsNote: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.5",
  },
  profileToolsCard: {
    borderRadius: "10px",
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    display: "flex",
    flexDirection: "column",
    gap: SPACING.md,
  },
  profileToolsRow: {
    display: "flex",
    gap: SPACING.md,
    flexWrap: "wrap",
    "@media (max-width: 520px)": {
      "& .fui-Button": {
        flex: 1,
      },
    },
  },
  resultBox: {
    borderRadius: "10px",
    padding: "10px 12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  resultSuccess: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
  },
  resultError: {
    backgroundColor: tokens.colorPaletteRedBackground2,
  },
  resultTitle: {
    fontSize: "13px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  resultDetail: {
    fontSize: "12px",
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground2,
    wordBreak: "break-word",
  },
  codeList: {
    fontSize: "12px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
    wordBreak: "break-word",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
  },
});

// API 类型选项
const apiTypeOptions: { value: APIType; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

// API 端点格式示例
const endpointExamples: Record<APIType, string> = {
  openai: "https://api.openai.com/",
  anthropic: "https://api.anthropic.com/",
  gemini: "https://generativelanguage.googleapis.com/",
};

// 模型名称示例
const modelExamples: Record<APIType, string> = {
  openai: "gpt-4o-mini, gpt-4.5-preview, gpt-4.5-preview-02-21",
  anthropic: "claude-4-5-haiku, claude-4-5-sonnet-20250219, claude-4-5-opus-20250219",
  gemini: "gemini-3-pro-preview, gemini-3-flash-preview",
};

const DEFAULT_PARALLEL_SECTIONS = getDefaultParallelSectionConcurrency();
const DEFAULT_REQUEST_TIMEOUT_MS = getDefaultRequestTimeoutMs();

function syncActiveProfileToAIConfig(store: {
  profiles: AIProfile[];
  activeProfileId: string;
}) {
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
    requestTimeoutMs: active.requestTimeoutMs,
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

const Settings: React.FC = () => {
  const styles = useStyles();
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [showApiKeyFor, setShowApiKeyFor] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"api" | "prompts">("api");
  const [contextMenuTranslateTarget, setContextMenuTranslateTarget] = useState<TranslationTargetLanguage>(
    DEFAULT_TRANSLATION_TARGET_LANGUAGE
  );
  const [contextMenuSaving, setContextMenuSaving] = useState(false);

  // Prompt settings
  const [selectedPromptKey, setSelectedPromptKey] = useState<PromptKey>("assistant_agent");
  const [promptDraft, setPromptDraft] = useState<string>(() => getPrompt("assistant_agent"));
  const [promptSaving, setPromptSaving] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [probingProfileId, setProbingProfileId] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<Record<string, ConnectionTestResult>>({});
  const [modelProbeResults, setModelProbeResults] = useState<Record<string, ModelProbeResult>>({});

  const refreshRuntimeDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      const diagnostics = await loadRuntimeDiagnostics();
      setRuntimeDiagnostics(diagnostics);
    } catch (error) {
      setRuntimeDiagnostics(null);
      setDiagnosticsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const store = await loadSettingsStore();
      setProfiles(store.profiles);
      setActiveProfileId(store.activeProfileId);
      setExpandedProfileId(null);
      syncActiveProfileToAIConfig(store);

      const contextMenuPreferences = loadContextMenuPreferences();
      setContextMenuTranslateTarget(contextMenuPreferences.translateTargetLanguage);
      setDiagnosticsLoading(true);
      setDiagnosticsError(null);
      try {
        const diagnostics = await loadRuntimeDiagnostics();
        setRuntimeDiagnostics(diagnostics);
      } catch (error) {
        setRuntimeDiagnostics(null);
        setDiagnosticsError(error instanceof Error ? error.message : String(error));
      } finally {
        setDiagnosticsLoading(false);
      }
    };
    init().catch(() => {
      setMessage({ type: "error", text: "设置初始化失败，请刷新后重试" });
    });
  }, []);

  useEffect(() => {
    setPromptDraft(getPrompt(selectedPromptKey));
  }, [selectedPromptKey]);

  const getApiTypeLabel = (value: APIType) => {
    const option = apiTypeOptions.find((o) => o.value === value);
    return option?.label || value;
  };

  const getUniqueProfileName = () => {
    const existingNames = new Set(profiles.map((profile) => profile.name));
    if (!existingNames.has("新配置")) return "新配置";
    let index = 1;
    while (existingNames.has(`新配置 ${index}`)) {
      index += 1;
    }
    return `新配置 ${index}`;
  };

  const persistStore = async (
    nextProfiles: AIProfile[],
    nextActiveId: string,
    successMessage?: string
  ) => {
    try {
      await saveSettingsStore({
        version: 2,
        activeProfileId: nextActiveId,
        profiles: nextProfiles,
      });
      const store = await loadSettingsStore();
      setProfiles(store.profiles);
      setActiveProfileId(store.activeProfileId);
      syncActiveProfileToAIConfig(store);
      await refreshRuntimeDiagnostics();

      if (successMessage) {
        setMessage({ type: "success", text: successMessage });
      }
    } catch {
      setMessage({ type: "error", text: "保存失败，请重试" });
    }
  };

  const handleAddProfile = async () => {
    setMessage(null);
    const name = getUniqueProfileName();
    const newProfile = createProfile(name);
    const nextProfiles = [...profiles, newProfile];
    const nextActiveId = activeProfileId || newProfile.id;
    setProfiles(nextProfiles);
    setExpandedProfileId(newProfile.id);
    setShowApiKeyFor(null);
    await persistStore(nextProfiles, nextActiveId);
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) return;
    setMessage(null);
    const remaining = profiles.filter((profile) => profile.id !== profileId);
    const nextActiveId = activeProfileId === profileId
      ? remaining[0]?.id || ""
      : activeProfileId;
    setProfiles(remaining);
    if (expandedProfileId === profileId) {
      setExpandedProfileId(null);
    }
    await persistStore(remaining, nextActiveId, "配置已删除");
  };

  const handleReset = async () => {
    try {
      await clearSettings();
      const store = await loadSettingsStore();
      setProfiles(store.profiles);
      setActiveProfileId(store.activeProfileId);
      setExpandedProfileId(null);
      syncActiveProfileToAIConfig(store);
      const contextMenuPreferences = loadContextMenuPreferences();
      setContextMenuTranslateTarget(contextMenuPreferences.translateTargetLanguage);
      setConnectionResults({});
      setModelProbeResults({});
      await refreshRuntimeDiagnostics();
      setMessage({ type: "success", text: "设置已重置" });
    } catch {
      setMessage({ type: "error", text: "重置失败，请重试" });
    }
  };

  const handleProfileChange = (profileId: string, field: keyof AIProfile, value: string) => {
    setProfiles((prev) =>
      prev.map((profile) =>
        profile.id === profileId
          ? { ...profile, [field]: value }
          : profile
      )
    );
  };

  const parseOptionalFloat = (rawValue: string): number | undefined => {
    const trimmed = rawValue.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const parseOptionalInt = (rawValue: string): number | undefined => {
    const trimmed = rawValue.trim();
    if (!trimmed) return undefined;
    const parsed = parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const handleProfileNumberChange = (
    profileId: string,
    field: keyof AIProfile,
    rawValue: string,
    parser: (value: string) => number | undefined
  ) => {
    const parsed = parser(rawValue);
    setProfiles((prev) =>
      prev.map((profile) =>
        profile.id === profileId
          ? { ...profile, [field]: parsed }
          : profile
      )
    );
  };

  const handleMaxOutputTokensChange = (profileId: string, rawValue: string) => {
    const trimmed = rawValue.trim();
    const parsed = trimmed ? parseInt(trimmed, 10) : undefined;
    const maxOutputTokens = typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;

    setProfiles((prev) =>
      prev.map((profile) =>
        profile.id === profileId
          ? { ...profile, maxOutputTokens }
          : profile
      )
    );
  };

  const handleApiTypeChange = (profileId: string, newType: APIType) => {
    const defaults = getApiDefaults(newType);
    setProfiles((prev) =>
      prev.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              apiType: newType,
              apiEndpoint: defaults.apiEndpoint,
              model: defaults.model,
            }
          : profile
      )
    );
  };

  const handleSaveProfile = async (profileId: string) => {
    setSavingId(profileId);
    setMessage(null);
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      setSavingId(null);
      return;
    }

    const validationError = getAISettingsValidationError(profile);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      setSavingId(null);
      return;
    }

    // 用户可配置 max_tokens；留空时使用默认值（65535）
    const normalizedMaxTokens = normalizeMaxOutputTokens(profile.maxOutputTokens);
    const effectiveMaxTokens = normalizedMaxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

    const nextProfiles = profiles.map((item) =>
      item.id === profileId
        ? { ...item, name: item.name.trim(), maxOutputTokens: normalizedMaxTokens }
        : item
    );
    await persistStore(
      nextProfiles,
      activeProfileId,
      `配置已保存（最大输出: ${effectiveMaxTokens} tokens）`
    );
    setSavingId(null);
  };

  const handleSetActive = async (profileId: string) => {
    if (profileId === activeProfileId) return;
    setMessage(null);
    setActiveProfileId(profileId);
    await persistStore(profiles, profileId, "已启用该配置");
  };

  const handleSaveContextMenuPreference = async () => {
    setContextMenuSaving(true);
    setMessage(null);
    try {
      await saveContextMenuPreferences({
        translateTargetLanguage: contextMenuTranslateTarget,
      });
      setMessage({ type: "success", text: "右键翻译偏好已保存" });
    } catch {
      setMessage({ type: "error", text: "右键翻译偏好保存失败，请重试" });
    } finally {
      setContextMenuSaving(false);
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "未检测到";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString();
  };

  const getOfficeHostSummary = () => {
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

  const getProbeValidationError = (profile: AIProfile) => {
    const missing: string[] = [];
    if (!profile.apiKey?.trim()) missing.push("API 密钥");
    if (!profile.apiEndpoint?.trim()) missing.push("API 端点");
    return missing.length > 0 ? `请先填写：${missing.join("、")}` : null;
  };

  const handleConnectionTest = async (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    const validationError = getAISettingsValidationError(profile);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setTestingProfileId(profileId);
    setMessage(null);
    try {
      const result = await testAIProfileConnection(profile);
      setConnectionResults((prev) => ({ ...prev, [profileId]: result }));
    } finally {
      setTestingProfileId(null);
    }
  };

  const handleModelProbe = async (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    const validationError = getProbeValidationError(profile);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setProbingProfileId(profileId);
    setMessage(null);
    try {
      const result = await probeAIProfileModels(profile);
      setModelProbeResults((prev) => ({ ...prev, [profileId]: result }));
    } finally {
      setProbingProfileId(null);
    }
  };

  const toggleExpand = (profileId: string) => {
    setExpandedProfileId((prev) => (prev === profileId ? null : profileId));
    setShowApiKeyFor(null);
  };

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const officeHostSummary = getOfficeHostSummary();
  const selectedPromptDefinition =
    PROMPT_DEFINITIONS.find((def) => def.key === selectedPromptKey) || PROMPT_DEFINITIONS[0];
  const promptIsCustomized = isPromptCustomized(selectedPromptKey);

  const handleSavePrompt = async () => {
    setPromptSaving(true);
    setMessage(null);
    try {
      await savePrompt(selectedPromptKey, promptDraft);
      setPromptDraft(getPrompt(selectedPromptKey));
      setMessage({ type: "success", text: "提示词已保存" });
    } catch {
      setMessage({ type: "error", text: "提示词保存失败，请重试" });
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetPrompt = async () => {
    setPromptSaving(true);
    setMessage(null);
    try {
      await resetPrompt(selectedPromptKey);
      setPromptDraft(getDefaultPrompt(selectedPromptKey));
      setMessage({ type: "success", text: "已恢复默认提示词" });
    } catch {
      setMessage({ type: "error", text: "重置失败，请重试" });
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetAllPrompts = async () => {
    const confirmed = window.confirm("将恢复所有提示词为默认值，是否继续？");
    if (!confirmed) return;
    setPromptSaving(true);
    setMessage(null);
    try {
      await resetAllPrompts();
      setSelectedPromptKey("assistant_agent");
      setPromptDraft(getDefaultPrompt("assistant_agent"));
      setMessage({ type: "success", text: "所有提示词已恢复默认" });
    } catch {
      setMessage({ type: "error", text: "重置失败，请重试" });
    } finally {
      setPromptSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.topArea}>
        <div className={styles.tabs}>
          <TabList
            className={styles.tabList}
            selectedValue={settingsTab}
            onTabSelect={(_, data) => {
              setMessage(null);
              setSettingsTab(data.value as "api" | "prompts");
            }}
          >
            <Tab value="api">API 配置</Tab>
            <Tab value="prompts">提示词</Tab>
          </TabList>
        </div>

        {message && (
          <MessageBar intent={message.type === "success" ? "success" : "error"}>
            <MessageBarBody>{message.text}</MessageBarBody>
          </MessageBar>
        )}
      </div>

      <div className={styles.scrollArea}>
        {settingsTab === "api" ? (
          <>
            <div className={styles.actionRow}>
              <Text className={styles.activeHint}>当前启用：{activeProfile?.name || "未选择"}</Text>
              <div className={styles.actionButtons}>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleAddProfile}>
                  添加配置
                </Button>
                <Button appearance="secondary" icon={<Delete24Regular />} onClick={handleReset}>
                  重置全部
                </Button>
              </div>
            </div>

            <Card className={mergeClasses(styles.card, styles.cardStatic)}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderInfo}>
                  <Text className={styles.cardHeaderTitle}>运行环境诊断面板</Text>
                  <Text className={styles.cardHeaderMeta}>定位本地服务、证书、Manifest 与宿主环境状态</Text>
                </div>
                <div className={styles.headerActions}>
                  <Button
                    size="small"
                    appearance="secondary"
                    className={styles.smallButton}
                    onClick={refreshRuntimeDiagnostics}
                    disabled={diagnosticsLoading}
                  >
                    {diagnosticsLoading ? "刷新中..." : "刷新诊断"}
                  </Button>
                </div>
              </div>
              <div className={styles.cardContent}>
                <div className={styles.diagnosticsGrid}>
                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>本地服务</Text>
                    <Text className={styles.diagnosticValue}>
                      {runtimeDiagnostics?.service.status || (diagnosticsLoading ? "检测中..." : "未获取")}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      模式：{runtimeDiagnostics?.service.mode || "未知"}
                      {"\n"}
                      账户：{runtimeDiagnostics?.service.serviceAccount || "未知"}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>端口与证书</Text>
                    <Text className={styles.diagnosticValue}>
                      {runtimeDiagnostics?.port.host || "localhost"}:{runtimeDiagnostics?.port.port || 53000}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      监听：{runtimeDiagnostics?.port.listening ? "已监听" : "未监听"}
                      {"\n"}
                      证书文件：{runtimeDiagnostics?.certificate.filesPresent ? "存在" : "缺失"}
                      {"\n"}
                      根证书：{runtimeDiagnostics?.certificate.rootInstalled === null
                        ? "未知"
                        : runtimeDiagnostics?.certificate.rootInstalled
                          ? "已安装"
                          : "未安装"}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>证书有效期</Text>
                    <Text className={styles.diagnosticValue}>
                      {formatDateTime(runtimeDiagnostics?.certificate.validTo)}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      证书路径：{runtimeDiagnostics?.certificate.certPath || "未检测到"}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>Manifest 与 Office</Text>
                    <Text className={styles.diagnosticValue}>
                      Manifest {runtimeDiagnostics?.manifest.version || "未检测到"}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      宿主：{officeHostSummary.host}
                      {"\n"}
                      平台：{officeHostSummary.platform}
                      {"\n"}
                      版本：{officeHostSummary.version}
                      {"\n"}
                      语言：{officeHostSummary.language}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>当前模型配置</Text>
                    <Text className={styles.diagnosticValue}>
                      {activeProfile ? `${getApiTypeLabel(activeProfile.apiType)} · ${activeProfile.model || "未填写模型"}` : "未配置"}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      端点：{activeProfile?.apiEndpoint || "未填写"}
                      {"\n"}
                      并行章节：{activeProfile?.parallelSectionConcurrency ?? DEFAULT_PARALLEL_SECTIONS}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>安全与密钥存储</Text>
                    <Text className={styles.diagnosticValue}>
                      {runtimeDiagnostics?.storage.backend || "服务不可用时回退到 localStorage"}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      API 鉴权：{runtimeDiagnostics?.security.clientHeaderRequired ? "要求本加载项请求头" : "未启用"}
                      {"\n"}
                      来源限制：{runtimeDiagnostics?.security.sameOriginOnly ? "仅本加载项同源请求" : "未启用"}
                      {"\n"}
                      存储文件：{runtimeDiagnostics?.storage.filePath || "未检测到"}
                      {"\n"}
                      文件状态：{runtimeDiagnostics?.storage.exists ? "已创建" : "未创建"}
                    </Text>
                  </div>
                </div>

                <Text className={styles.diagnosticsNote}>
                  {diagnosticsError
                    ? `诊断接口不可用：${diagnosticsError}。开发模式下会回退到浏览器本地存储。`
                    : "设置保存后会优先写入本地服务的 Windows DPAPI 安全存储；仅在服务不可用时回退到浏览器本地存储。"}
                </Text>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderInfo}>
                  <Text className={styles.cardHeaderTitle}>右键菜单偏好</Text>
                  <Text className={styles.cardHeaderMeta}>设置 Word 右键“翻译”命令默认目标语言</Text>
                </div>
              </div>
              <div className={styles.cardContent}>
                <Field label="翻译目标语言">
                  <Dropdown
                    className={styles.modelDropdown}
                    value={getTranslationTargetLabel(contextMenuTranslateTarget)}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) {
                        setContextMenuTranslateTarget(data.optionValue as TranslationTargetLanguage);
                      }
                    }}
                  >
                    {TRANSLATION_TARGET_OPTIONS.map((option) => (
                      <Option key={option.code} value={option.code}>
                        {option.label}
                      </Option>
                    ))}
                  </Dropdown>
                  <Text className={styles.hint}>
                    仅影响右键菜单的“翻译”命令；助手面板内翻译使用会话中的语言设置。
                  </Text>
                </Field>

                <div className={styles.cardActions}>
                  <Button
                    className={styles.primaryButton}
                    appearance="primary"
                    icon={<Save24Regular />}
                    onClick={handleSaveContextMenuPreference}
                    disabled={contextMenuSaving}
                  >
                    {contextMenuSaving ? "保存中..." : "保存右键偏好"}
                  </Button>
                </div>
              </div>
            </Card>

            <div className={styles.profilesList}>
              {profiles.map((profile, index) => {
                const isActive = profile.id === activeProfileId;
                const isExpanded = profile.id === expandedProfileId;
                const validationError = getAISettingsValidationError(profile);
                const showKey = showApiKeyFor === profile.id;
                const displayName = profile.name?.trim() || `配置 ${index + 1}`;
                const connectionResult = connectionResults[profile.id];
                const modelProbeResult = modelProbeResults[profile.id];
                return (
                  <Card
                    key={profile.id}
                    className={mergeClasses(styles.card, isExpanded && styles.cardExpanded)}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.cardHeaderInfo}>
                        <Text className={styles.cardHeaderTitle}>{displayName}</Text>
                        <Text className={styles.cardHeaderMeta}>
                          {getApiTypeLabel(profile.apiType)} · {profile.model?.trim() || "未填写模型"}
                        </Text>
                      </div>
                      <div className={styles.cardHeaderStatus}>
                        {validationError && <Text className={styles.errorTag}>未完成</Text>}
                        {isActive && <Text className={styles.activeTag}>启用中</Text>}
                        <div className={styles.headerActions}>
                          {!isActive && (
                            <Button
                              size="small"
                              appearance="secondary"
                              className={styles.smallButton}
                              onClick={() => handleSetActive(profile.id)}
                            >
                              启用
                            </Button>
                          )}
                          <Button
                            size="small"
                            appearance="subtle"
                            className={styles.smallButton}
                            onClick={() => toggleExpand(profile.id)}
                          >
                            {isExpanded ? "收起" : "编辑"}
                          </Button>
                          <Button
                            size="small"
                            appearance="subtle"
                            className={styles.smallButton}
                            icon={<Delete24Regular />}
                            onClick={() => handleDeleteProfile(profile.id)}
                            disabled={profiles.length <= 1}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className={styles.cardContent}>
                        <div className={styles.formGrid}>
                          <Field className={styles.fieldSpanFull} label="配置名称">
                            <Input
                              className={styles.input}
                              value={profile.name}
                              onChange={(_, data) => handleProfileChange(profile.id, "name", data.value)}
                              placeholder="输入配置名称"
                            />
                          </Field>

                          <Field label="API 类型" required>
                            <Dropdown
                              className={styles.modelDropdown}
                              value={getApiTypeLabel(profile.apiType)}
                              onOptionSelect={(_, data) => {
                                if (data.optionValue) {
                                  handleApiTypeChange(profile.id, data.optionValue as APIType);
                                }
                              }}
                            >
                              {apiTypeOptions.map((option) => (
                                <Option key={option.value} value={option.value}>
                                  {option.label}
                                </Option>
                              ))}
                            </Dropdown>
                            <Text className={styles.hint}>选择您要使用的 AI 服务提供商</Text>
                          </Field>

                          <Field label="最大输出 (max_tokens)">
                            <Input
                              className={styles.input}
                              type="number"
                              value={profile.maxOutputTokens !== undefined ? String(profile.maxOutputTokens) : ""}
                              onChange={(_, data) => handleMaxOutputTokensChange(profile.id, data.value)}
                              placeholder={`留空默认 ${DEFAULT_MAX_OUTPUT_TOKENS}`}
                            />
                            <Text className={styles.hint}>
                              留空将使用默认值 {DEFAULT_MAX_OUTPUT_TOKENS}；如遇到 max_tokens 限制报错，请根据接口提示改小。
                            </Text>
                          </Field>

                          <Field label="请求超时 (ms)">
                            <Input
                              className={styles.input}
                              type="number"
                              min="5000"
                              max="300000"
                              value={profile.requestTimeoutMs !== undefined ? String(profile.requestTimeoutMs) : ""}
                              onChange={(_, data) =>
                                handleProfileNumberChange(profile.id, "requestTimeoutMs", data.value, parseOptionalInt)
                              }
                              placeholder={`留空默认 ${DEFAULT_REQUEST_TIMEOUT_MS}`}
                            />
                            <Text className={styles.hint}>
                              用于单次模型请求、连接测试和模型探测；默认 {DEFAULT_REQUEST_TIMEOUT_MS} ms，范围 5000-300000。
                            </Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="模型名称" required>
                            <Input
                              className={styles.input}
                              value={profile.model}
                              onChange={(_, data) => handleProfileChange(profile.id, "model", data.value)}
                              placeholder="输入模型名称"
                            />
                            <Text className={styles.hint}>可用模型示例：{modelExamples[profile.apiType]}</Text>
                          </Field>

                          <Field label="Planner 模型">
                            <Input
                              className={styles.input}
                              value={profile.plannerModel ?? ""}
                              onChange={(_, data) => handleProfileChange(profile.id, "plannerModel", data.value)}
                              placeholder="留空则跟随主模型"
                            />
                            <Text className={styles.hint}>用于大纲规划阶段，可单独指定更擅长结构化输出的模型。</Text>
                          </Field>

                          <Field label="Planner 温度">
                            <Input
                              className={styles.input}
                              type="number"
                              step="0.1"
                              min="0"
                              max="2"
                              value={profile.plannerTemperature !== undefined ? String(profile.plannerTemperature) : ""}
                              onChange={(_, data) =>
                                handleProfileNumberChange(profile.id, "plannerTemperature", data.value, parseOptionalFloat)
                              }
                              placeholder="例如 0.2"
                            />
                            <Text className={styles.hint}>范围 0-2，建议规划阶段使用较低温度。</Text>
                          </Field>

                          <Field label="Writer 模型">
                            <Input
                              className={styles.input}
                              value={profile.writerModel ?? ""}
                              onChange={(_, data) => handleProfileChange(profile.id, "writerModel", data.value)}
                              placeholder="留空则跟随主模型"
                            />
                            <Text className={styles.hint}>用于章节生成与修订阶段，可偏向生成能力更强的模型。</Text>
                          </Field>

                          <Field label="Writer 温度">
                            <Input
                              className={styles.input}
                              type="number"
                              step="0.1"
                              min="0"
                              max="2"
                              value={profile.writerTemperature !== undefined ? String(profile.writerTemperature) : ""}
                              onChange={(_, data) =>
                                handleProfileNumberChange(profile.id, "writerTemperature", data.value, parseOptionalFloat)
                              }
                              placeholder="例如 0.7"
                            />
                            <Text className={styles.hint}>范围 0-2，建议写作阶段使用中等温度。</Text>
                          </Field>

                          <Field label="Reviewer 模型">
                            <Input
                              className={styles.input}
                              value={profile.reviewerModel ?? ""}
                              onChange={(_, data) => handleProfileChange(profile.id, "reviewerModel", data.value)}
                              placeholder="留空则跟随主模型"
                            />
                            <Text className={styles.hint}>用于审阅阶段，可单独指定更擅长审校与一致性的模型。</Text>
                          </Field>

                          <Field label="Reviewer 温度">
                            <Input
                              className={styles.input}
                              type="number"
                              step="0.1"
                              min="0"
                              max="2"
                              value={profile.reviewerTemperature !== undefined ? String(profile.reviewerTemperature) : ""}
                              onChange={(_, data) =>
                                handleProfileNumberChange(profile.id, "reviewerTemperature", data.value, parseOptionalFloat)
                              }
                              placeholder="例如 0.1"
                            />
                            <Text className={styles.hint}>范围 0-2，建议审阅阶段使用较低温度。</Text>
                          </Field>

                          <Field label="并行章节数">
                            <Input
                              className={styles.input}
                              type="number"
                              min="1"
                              max="6"
                              value={
                                profile.parallelSectionConcurrency !== undefined
                                  ? String(profile.parallelSectionConcurrency)
                                  : ""
                              }
                              onChange={(_, data) =>
                                handleProfileNumberChange(
                                  profile.id,
                                  "parallelSectionConcurrency",
                                  data.value,
                                  parseOptionalInt
                                )
                              }
                              placeholder={`留空默认 ${DEFAULT_PARALLEL_SECTIONS}`}
                            />
                            <Text className={styles.hint}>章节并行草稿生成的最大并发，范围 1-6。</Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="API 密钥" required>
                            <div className={styles.inputWrapper}>
                              <Input
                                className={styles.input}
                                type={showKey ? "text" : "password"}
                                value={profile.apiKey}
                                onChange={(_, data) => handleProfileChange(profile.id, "apiKey", data.value)}
                                placeholder="输入您的 API 密钥"
                              />
                              <Button
                                className={styles.eyeButton}
                                icon={showKey ? <EyeOff24Regular /> : <Eye24Regular />}
                                appearance="subtle"
                                onClick={() => setShowApiKeyFor(showKey ? null : profile.id)}
                              />
                            </div>
                            <Text className={styles.hint}>您的 API 密钥仅保存在本地</Text>
                            <Text className={styles.hint}>
                              本地服务可用时将优先写入 Windows DPAPI 安全存储；仅在服务不可用时回退到浏览器本地存储。
                            </Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="API 端点" required>
                            <Input
                              className={styles.input}
                              value={profile.apiEndpoint}
                              onChange={(_, data) => handleProfileChange(profile.id, "apiEndpoint", data.value)}
                              placeholder="输入 API 端点地址"
                            />
                            <Text className={styles.hint}>
                              Use base URL only (e.g. {endpointExamples[profile.apiType]}). Path suffix is
                              auto-filled by channel type.
                            </Text>
                          </Field>
                        </div>

                        <div className={styles.profileToolsCard}>
                          <Text weight="semibold">连接测试与模型探测</Text>
                          <Text className={styles.hint}>
                            使用当前卡片中的临时编辑值直接发起探测，无需先保存后再试错。
                          </Text>

                          <div className={styles.profileToolsRow}>
                            <Button
                              appearance="secondary"
                              className={styles.smallButton}
                              onClick={() => handleConnectionTest(profile.id)}
                              disabled={testingProfileId === profile.id}
                            >
                              {testingProfileId === profile.id ? "测试中..." : "连接测试"}
                            </Button>
                            <Button
                              appearance="secondary"
                              className={styles.smallButton}
                              onClick={() => handleModelProbe(profile.id)}
                              disabled={probingProfileId === profile.id}
                            >
                              {probingProfileId === profile.id ? "探测中..." : "模型探测"}
                            </Button>
                          </div>

                          {connectionResult && (
                            <div
                              className={mergeClasses(
                                styles.resultBox,
                                connectionResult.ok ? styles.resultSuccess : styles.resultError
                              )}
                            >
                              <Text className={styles.resultTitle}>
                                连接测试：{connectionResult.ok ? "通过" : "失败"}
                              </Text>
                              <Text className={styles.resultDetail}>
                                {connectionResult.message}
                                {"\n"}
                                模型：{connectionResult.model || "未填写"}
                                {"\n"}
                                端点：{connectionResult.endpoint}
                                {"\n"}
                                耗时：{connectionResult.latencyMs} ms
                                {connectionResult.detail ? `\n详情：${connectionResult.detail}` : ""}
                              </Text>
                            </div>
                          )}

                          {modelProbeResult && (
                            <div
                              className={mergeClasses(
                                styles.resultBox,
                                modelProbeResult.ok ? styles.resultSuccess : styles.resultError
                              )}
                            >
                              <Text className={styles.resultTitle}>
                                模型探测：{modelProbeResult.ok ? "已完成" : "失败"}
                              </Text>
                              <Text className={styles.resultDetail}>
                                {modelProbeResult.message}
                                {"\n"}
                                当前模型：{modelProbeResult.currentModel || "未填写"}
                                {"\n"}
                                当前模型状态：{modelProbeResult.currentModel
                                  ? modelProbeResult.currentModelAvailable
                                    ? "在可用列表中"
                                    : "未在可用列表中"
                                  : "未填写，无法比对"}
                                {modelProbeResult.detail ? `\n详情：${modelProbeResult.detail}` : ""}
                              </Text>
                              {modelProbeResult.models.length > 0 && (
                                <Text className={styles.codeList}>
                                  {modelProbeResult.models.slice(0, 12).join("、")}
                                  {modelProbeResult.models.length > 12
                                    ? ` 等 ${modelProbeResult.models.length} 个模型`
                                    : ""}
                                </Text>
                              )}
                            </div>
                          )}
                        </div>

                        <div className={styles.cardActions}>
                          <Button
                            className={styles.primaryButton}
                            appearance="primary"
                            icon={<Save24Regular />}
                            onClick={() => handleSaveProfile(profile.id)}
                            disabled={savingId === profile.id}
                          >
                            {savingId === profile.id ? "保存中..." : "保存配置"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            <div className={styles.infoCard}>
              <Text weight="semibold" style={{ marginBottom: "8px", display: "block" }}>
                使用说明
              </Text>
              <Text className={styles.infoText}>
                1. 点击“添加配置”创建多个 API 配置
                <br />
                2. 前往对应官网获取 API 密钥：
              </Text>
              <ul className={styles.infoList}>
                <li className={styles.infoListItem}>OpenAI: platform.openai.com</li>
                <li className={styles.infoListItem}>Anthropic: console.anthropic.com</li>
                <li className={styles.infoListItem}>Gemini: aistudio.google.com</li>
              </ul>
              <Text className={styles.infoText}>
                3. 填入 API 密钥、端点地址和模型名称
                <br />
                4. 点击“启用”切换当前使用配置，点击“保存配置”完成保存
              </Text>
            </div>
          </>
        ) : (
          <Card className={mergeClasses(styles.card, styles.promptCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderInfo}>
                <Text className={styles.cardHeaderTitle}>提示词设置</Text>
                <Text className={styles.cardHeaderMeta}>可查看/修改各项功能系统提示词（仅本地保存）</Text>
              </div>
              <div className={styles.headerActions}>
                <Button
                  size="small"
                  appearance="secondary"
                  className={styles.smallButton}
                  icon={<Delete24Regular />}
                  onClick={handleResetAllPrompts}
                  disabled={promptSaving}
                >
                  全部恢复默认
                </Button>
              </div>
            </div>

            <div className={styles.promptCardContent}>
              <Field label="选择功能" required>
                <Dropdown
                  className={styles.modelDropdown}
                  value={selectedPromptDefinition?.title || ""}
                  onOptionSelect={(_, data) => {
                    if (data.optionValue) {
                      setSelectedPromptKey(data.optionValue as PromptKey);
                    }
                  }}
                >
                  {PROMPT_DEFINITIONS.map((def) => (
                    <Option key={def.key} value={def.key}>
                      {def.title}
                    </Option>
                  ))}
                </Dropdown>
                <Text className={styles.hint}>{selectedPromptDefinition?.description}</Text>
              </Field>

              <div className={styles.promptMetaRow}>
                <Text className={styles.promptTitle}>{selectedPromptDefinition?.title || "提示词"}</Text>
                <Text className={styles.promptBadge}>{promptIsCustomized ? "已自定义" : "默认"}</Text>
              </div>

              {selectedPromptDefinition?.variables && selectedPromptDefinition.variables.length > 0 && (
                <Text className={styles.hint}>
                  可用变量：{selectedPromptDefinition.variables.map((v) => `{{${v.name}}}`).join("、")}
                </Text>
              )}

              <Field className={styles.promptEditorField} label="系统提示词">
                <Textarea
                  className={styles.promptTextarea}
                  value={promptDraft}
                  onChange={(_, data) => setPromptDraft(data.value)}
                  appearance="filled-lighter"
                />
              </Field>

              <div className={styles.promptActions}>
                <Button appearance="secondary" onClick={handleResetPrompt} disabled={promptSaving}>
                  恢复默认
                </Button>
                <Button
                  appearance="primary"
                  icon={<Save24Regular />}
                  onClick={handleSavePrompt}
                  disabled={promptSaving}
                >
                  {promptSaving ? "保存中..." : "保存提示词"}
                </Button>
              </div>

              <Text className={styles.hint}>修改提示词后，将对下一次调用生效；提示词仅保存在本地。</Text>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};


export default Settings;
