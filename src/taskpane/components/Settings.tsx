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
  Spinner,
  Dropdown,
  Option,
  Field,
  TabList,
  Tab,
  Switch,
} from "@fluentui/react-components";
import {
  Save24Regular,
  Delete24Regular,
  Eye24Regular,
  EyeOff24Regular,
  Add24Regular,
  ArrowSync24Regular,
} from "@fluentui/react-icons";
import {
  loadContextMenuPreferences,
  saveSettingsStore,
  saveContextMenuPreferences,
  loadSettingsStore,
  getApiDefaults,
  getDefaultParallelSectionConcurrency,
  getDefaultRequestTimeoutMs,
  getAISettingsValidationError,
  getDefaultSystemProxyPort,
  getDefaultSystemProxySettings,
  getSystemProxyValidationError,
  hasConfiguredSystemProxy,
  createProfile,
  AIProfile,
  APIType,
  AISettingsStore,
  SystemProxyProtocol,
  SystemProxySettings,
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
  PromptKey,
  getPromptDefinitions,
  getPrompt,
  getDefaultPrompt,
  getStoredPromptOverride,
  isPromptCustomized,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
} from "../../utils/promptService";
import {
  type AssistantModuleDefinition,
  type AssistantModuleIconKey,
  type AssistantSimpleBehavior,
  createCustomAssistantModule,
  getAllAssistantModules,
  getDeletedAssistantModules,
  getAssistantModuleModeLabel,
  getDefaultAssistantModuleInputPlaceholder,
  getDefaultPromptTemplateForBehavior,
  restoreDefaultAssistantModules,
  restoreLastDeletedAssistantModule,
  saveAssistantModules,
  stashDeletedAssistantModule,
} from "../../utils/assistantModuleService";
import { getAssistantModuleIcon } from "../../utils/actionIcons";
import { ASSISTANT_MODULE_ICON_OPTIONS } from "../../utils/assistantModuleIconOptions";
import {
  CONTROL_HEIGHT_LG,
  CONTROL_HEIGHT_MD,
  PAGE_BOTTOM_SAFE_PADDING,
  SPACING,
} from "../ui/layoutConstants";
import { NATIVE_RADIUS } from "../ui/nativeTokens";
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
    gap: SPACING.sm,
  },
  topArea: {
    display: "flex",
    flexDirection: "column",
    gap: SPACING.sm,
    flexShrink: 0,
  },
  scrollArea: {
    flex: 1,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: SPACING.md,
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
      minHeight: CONTROL_HEIGHT_MD,
    },
  },
  actionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.md,
    flexWrap: "wrap",
    padding: "8px 10px",
    borderRadius: NATIVE_RADIUS.medium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    position: "sticky",
    top: 0,
    zIndex: 2,
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
    gap: SPACING.sm,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    "& > button": {
      flex: "0 0 auto",
      minWidth: "96px",
    },
  },
  profilesList: {
    display: "flex",
    flexDirection: "column",
    gap: SPACING.md,
  },
  card: {
    borderRadius: NATIVE_RADIUS.medium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "visible",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    maxHeight: "none",
  },
  cardExpanded: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
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
    borderTopLeftRadius: NATIVE_RADIUS.medium,
    borderTopRightRadius: NATIVE_RADIUS.medium,
  },
  cardHeaderInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    flex: 1,
  },
  moduleTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: SPACING.sm,
    minWidth: 0,
  },
  moduleTitleIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  cardHeaderTitle: {
    fontSize: "13px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "normal",
  },
  cardHeaderMeta: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.4",
    whiteSpace: "normal",
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
    "& > button": {
      flex: "0 0 auto",
      minWidth: "64px",
    },
  },
  cardContent: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: SPACING.md,
    minHeight: 0,
    overflow: "visible",
  },
  formGrid: {
    display: "grid",
    gap: SPACING.md,
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
      borderRadius: NATIVE_RADIUS.large,
    },
  },
  eyeButton: {
    minWidth: CONTROL_HEIGHT_LG,
    minHeight: CONTROL_HEIGHT_LG,
    borderRadius: NATIVE_RADIUS.large,
    flexShrink: 0,
    "@media (max-width: 480px)": {
      width: "100%",
    },
  },
  smallButton: {
    borderRadius: NATIVE_RADIUS.large,
    minHeight: CONTROL_HEIGHT_MD,
  },
  hint: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  modelDropdown: {
    minWidth: "100%",
    "& button": {
      borderRadius: NATIVE_RADIUS.large,
    },
  },
  cardActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: SPACING.md,
    flexWrap: "wrap",
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    "& > button": {
      flex: "0 0 auto",
      minWidth: "112px",
    },
  },
  primaryButton: {
    borderRadius: NATIVE_RADIUS.large,
    minHeight: CONTROL_HEIGHT_LG,
  },
  infoCard: {
    borderRadius: NATIVE_RADIUS.medium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: "10px 12px",
  },
  infoText: {
    fontSize: "12px",
    lineHeight: "1.45",
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
    gap: SPACING.md,
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
    gap: SPACING.md,
    minHeight: 0,
    flex: 1,
    overflow: "visible",
  },
  promptEditorField: {
    display: "flex",
    flexDirection: "column",
  },
  promptTextarea: {
    width: "100%",
    "& textarea": {
      minHeight: "220px",
      height: "min(48vh, 420px)",
      resize: "vertical",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
      fontSize: "13px",
      lineHeight: "1.5",
    },
    "@media (max-height: 640px)": {
      "& textarea": {
        minHeight: "160px",
        height: "40vh",
      },
    },
  },
  compactTextarea: {
    width: "100%",
    "& textarea": {
      minHeight: "88px",
      resize: "vertical",
    },
  },
  iconPickerGrid: {
    display: "grid",
    gap: SPACING.sm,
    gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))",
    borderRadius: NATIVE_RADIUS.large,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: "8px",
    maxHeight: "280px",
    overflowY: "auto",
    scrollbarGutter: "stable",
  },
iconPickerButton: {
    appearance: "none",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    borderRadius: NATIVE_RADIUS.large,
    minHeight: "84px",
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    font: "inherit",
    "@media (prefers-reduced-motion: no-preference)": {
      transitionDuration: "120ms",
      transitionProperty: "background-color, border-color, color, box-shadow",
      transitionTimingFunction: "ease",
    },
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground2,
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  iconPickerButtonSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke1}`,
  },
  iconPickerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconPickerLabel: {
    fontSize: "12px",
    lineHeight: "1.25",
    textAlign: "center",
    wordBreak: "break-word",
  },
  iconPickerCurrent: {
    display: "flex",
    alignItems: "center",
    gap: SPACING.sm,
    color: tokens.colorNeutralForeground2,
    fontSize: "12px",
  },
  optionWithIcon: {
    display: "flex",
    alignItems: "center",
    gap: SPACING.sm,
  },
  optionIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  promptActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: SPACING.md,
    flexWrap: "wrap",
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginTop: SPACING.sm,
    "& > button": {
      flex: "0 0 auto",
      minWidth: "112px",
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
    borderRadius: NATIVE_RADIUS.medium,
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
    borderRadius: NATIVE_RADIUS.medium,
    padding: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: SPACING.md,
  },
  profileToolsRow: {
    display: "flex",
    gap: SPACING.md,
    flexWrap: "wrap",
    "& > button": {
      flex: "0 0 auto",
      minWidth: "100px",
    },
  },
  resultBox: {
    borderRadius: NATIVE_RADIUS.medium,
    padding: "10px 12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  resultSuccess: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    border: `1px solid ${tokens.colorPaletteGreenBorder2}`,
  },
  resultError: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
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
const DEFAULT_HTTP_PROXY_PORT = getDefaultSystemProxyPort("http");
const DEFAULT_SOCKS5_PROXY_PORT = getDefaultSystemProxyPort("socks5");

const systemProxyTypeOptions: { value: SystemProxyProtocol; label: string }[] = [
  { value: "http", label: "HTTP" },
  { value: "socks5", label: "SOCKS5" },
];

const customModuleBehaviorOptions: { value: AssistantSimpleBehavior; label: string }[] = [
  { value: "basic", label: "文本处理" },
  { value: "translation", label: "翻译" },
  { value: "style", label: "风格模板" },
];

function syncActiveProfileToAIConfig(store: AISettingsStore) {
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
    reviewerModel: active.reviewerModel,
    reviewerTemperature: active.reviewerTemperature,
    parallelSectionConcurrency: active.parallelSectionConcurrency,
  });
}

function getProfileDisplayName(profile?: AIProfile | null, fallbackName = "未选择"): string {
  return profile?.model?.trim() || profile?.name?.trim() || fallbackName;
}

const Settings: React.FC = () => {
  const styles = useStyles();
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [modules, setModules] = useState<AssistantModuleDefinition[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [systemProxy, setSystemProxy] = useState<SystemProxySettings>(() => getDefaultSystemProxySettings());
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [showApiKeyFor, setShowApiKeyFor] = useState<string | null>(null);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [moduleSavingId, setModuleSavingId] = useState<string | null>(null);
  const [proxySaving, setProxySaving] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"api" | "modules" | "prompts">("api");
  const [contextMenuTranslateTarget, setContextMenuTranslateTarget] = useState<TranslationTargetLanguage>(
    DEFAULT_TRANSLATION_TARGET_LANGUAGE
  );
  const [contextMenuSaving, setContextMenuSaving] = useState(false);

  // Prompt settings
  const [selectedPromptKey, setSelectedPromptKey] = useState<PromptKey>(
    () => getPromptDefinitions()[0]?.key || "agent_planner_v2"
  );
  const [promptDraft, setPromptDraft] = useState<string>(() => {
    const initialKey = getPromptDefinitions()[0]?.key || "agent_planner_v2";
    return getPrompt(initialKey);
  });
  const [promptSaving, setPromptSaving] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [probingProfileId, setProbingProfileId] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<Record<string, ConnectionTestResult>>({});
  const [modelProbeResults, setModelProbeResults] = useState<Record<string, ModelProbeResult>>({});
  const [deletedModuleCount, setDeletedModuleCount] = useState<number>(() => getDeletedAssistantModules().length);
  const modelProbeTimersRef = React.useRef<Record<string, number>>({});

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
      setModules(getAllAssistantModules());
      setDeletedModuleCount(getDeletedAssistantModules().length);
      setActiveProfileId(store.activeProfileId);
      setSystemProxy(store.systemProxy);
      setExpandedProfileId(null);
      setExpandedModuleId(null);
      setShowProxyPassword(false);
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

  useEffect(() => {
    const promptDefinitions = getPromptDefinitions(modules);
    if (promptDefinitions.length === 0) return;
    if (!promptDefinitions.some((def) => def.key === selectedPromptKey)) {
      setSelectedPromptKey(promptDefinitions[0].key);
    }
  }, [modules, selectedPromptKey]);

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
    nextSystemProxy: SystemProxySettings,
    successMessage?: string
  ) => {
    try {
      await saveSettingsStore({
        version: 3,
        activeProfileId: nextActiveId,
        profiles: nextProfiles,
        systemProxy: nextSystemProxy,
      });
      const store = await loadSettingsStore();
      setProfiles(store.profiles);
      setActiveProfileId(store.activeProfileId);
      setSystemProxy(store.systemProxy);
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
    const newProfileBase = createProfile(getUniqueProfileName());
    const newProfile = {
      ...newProfileBase,
      name: newProfileBase.model,
    };
    const nextProfiles = [...profiles, newProfile];
    const nextActiveId = activeProfileId || newProfile.id;
    setProfiles(nextProfiles);
    setExpandedProfileId(newProfile.id);
    setShowApiKeyFor(null);
    await persistStore(nextProfiles, nextActiveId, systemProxy);
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
    await persistStore(remaining, nextActiveId, systemProxy, "配置已删除");
  };

  const clearScheduledModelProbe = (profileId: string) => {
    const timer = modelProbeTimersRef.current[profileId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete modelProbeTimersRef.current[profileId];
    }
  };

  const runModelProbeForProfile = async (
    profile: AIProfile,
    options?: { silentValidation?: boolean }
  ) => {
    const validationError = getProbeValidationError(profile);
    if (validationError) {
      if (!options?.silentValidation) {
        setMessage({ type: "error", text: validationError });
      }
      return;
    }

    clearScheduledModelProbe(profile.id);
    setProbingProfileId(profile.id);
    if (!options?.silentValidation) {
      setMessage(null);
    }
    try {
      const result = await probeAIProfileModels(profile);
      setModelProbeResults((prev) => ({ ...prev, [profile.id]: result }));
    } finally {
      setProbingProfileId((prev) => (prev === profile.id ? null : prev));
    }
  };

  const scheduleModelProbe = (profile: AIProfile) => {
    clearScheduledModelProbe(profile.id);
    if (getProbeValidationError(profile)) {
      return;
    }

    modelProbeTimersRef.current[profile.id] = window.setTimeout(() => {
      delete modelProbeTimersRef.current[profile.id];
      void runModelProbeForProfile(profile, { silentValidation: true });
    }, 650);
  };

  useEffect(() => {
    return () => {
      Object.values(modelProbeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      modelProbeTimersRef.current = {};
    };
  }, []);

  const handleProfileChange = (profileId: string, field: keyof AIProfile, value: string) => {
    setProfiles((prev) =>
      prev.map((profile) => {
        if (profile.id !== profileId) {
          return profile;
        }
        const nextProfile = field === "model"
          ? { ...profile, model: value, name: value }
          : { ...profile, [field]: value };
        if (field === "model") {
          scheduleModelProbe(nextProfile);
        }
        return nextProfile;
      })
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

  const confirmAction = (
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
      prev.map((profile) => {
        if (profile.id !== profileId) {
          return profile;
        }
        const nextProfile = {
          ...profile,
          apiType: newType,
          apiEndpoint: defaults.apiEndpoint,
          model: defaults.model,
          name: defaults.model,
        };
        scheduleModelProbe(nextProfile);
        return nextProfile;
      })
    );
  };

  const handleSystemProxyProtocolChange = (protocol: SystemProxyProtocol) => {
    setSystemProxy((prev) => {
      const previousDefaultPort = getDefaultSystemProxyPort(prev.protocol);
      const nextDefaultPort = getDefaultSystemProxyPort(protocol);
      const shouldSwitchPort = prev.port === previousDefaultPort;

      return {
        ...prev,
        protocol,
        port: shouldSwitchPort ? nextDefaultPort : prev.port,
      };
    });
  };

  const handleSystemProxyFieldChange = (
    field: "host" | "username" | "password",
    value: string
  ) => {
    setSystemProxy((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSystemProxyPortChange = (rawValue: string) => {
    const parsed = parseOptionalInt(rawValue);
    setSystemProxy((prev) => ({
      ...prev,
      port: parsed ?? getDefaultSystemProxyPort(prev.protocol),
    }));
  };

  const handleSaveSystemProxy = async () => {
    setProxySaving(true);
    setMessage(null);

    const validationError = getSystemProxyValidationError(systemProxy);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      setProxySaving(false);
      return;
    }

    try {
      const successMessage = systemProxy.enabled
        ? `系统代理已保存，后续模型请求将经由 ${systemProxy.protocol.toUpperCase()} 代理转发`
        : "系统代理已关闭";
      await persistStore(profiles, activeProfileId, systemProxy, successMessage);
    } finally {
      setProxySaving(false);
    }
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
        ? {
            ...item,
            name: item.model.trim(),
            model: item.model.trim(),
            maxOutputTokens: normalizedMaxTokens,
          }
        : item
    );
    await persistStore(
      nextProfiles,
      activeProfileId,
      systemProxy,
      `配置已保存（最大输出: ${effectiveMaxTokens} tokens）`
    );
    setSavingId(null);
  };

  const handleSetActive = async (profileId: string) => {
    if (profileId === activeProfileId) return;
    setMessage(null);
    setActiveProfileId(profileId);
    await persistStore(profiles, profileId, systemProxy, "已启用该配置");
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

  const persistModules = async (
    nextModules: AssistantModuleDefinition[],
    successMessage?: string
  ) => {
    try {
      await saveAssistantModules(nextModules);
      const savedModules = getAllAssistantModules();
      setModules(savedModules);
      if (expandedModuleId && !savedModules.some((module) => module.id === expandedModuleId)) {
        setExpandedModuleId(null);
      }
      if (successMessage) {
        setMessage({ type: "success", text: successMessage });
      }
    } catch {
      setMessage({ type: "error", text: "模块保存失败，请重试" });
    }
  };

  const handleAddModule = async () => {
    setMessage(null);
    const newModule = createCustomAssistantModule(modules);
    const nextModules = [...modules, newModule];
    setModules(nextModules);
    setExpandedModuleId(newModule.id);
    await persistModules(nextModules, "已添加自定义模块");
  };

  const handleDeleteModule = async (moduleId: string) => {
    const target = modules.find((module) => module.id === moduleId);
    if (!target) return;
    const enabledModules = modules.filter((module) => module.enabled);
    if (target.enabled && enabledModules.length <= 1) {
      setMessage({ type: "error", text: "至少保留一个主页功能模块" });
      return;
    }

    setMessage(null);
    try {
      const promptOverride = target.promptKey ? getStoredPromptOverride(target.promptKey) : undefined;
      await stashDeletedAssistantModule(target, promptOverride);
      if (target.promptKey) {
        await resetPrompt(target.promptKey);
      }
      const nextModules = modules.filter((module) => module.id !== moduleId);
      setModules(nextModules);
      setDeletedModuleCount(getDeletedAssistantModules().length);
      if (expandedModuleId === moduleId) {
        setExpandedModuleId(null);
      }
      await persistModules(nextModules, "模块已删除，可点击“恢复最近删除”找回");
    } catch {
      setMessage({ type: "error", text: "删除模块失败，请重试" });
    }
  };

  const handleModuleFieldChange = (
    moduleId: string,
    field: "label" | "description" | "inputPlaceholder",
    value: string
  ) => {
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              [field]: value,
              ...(!module.builtIn && field === "label" ? { promptDescription: undefined } : {}),
            }
          : module
      )
    );
  };

  const handleModuleToggle = (moduleId: string, enabled: boolean) => {
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? { ...module, enabled }
          : module
      )
    );
  };

  const handleModuleOrderChange = (moduleId: string, rawValue: string) => {
    const parsed = parseOptionalInt(rawValue);
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? { ...module, order: parsed ?? module.order }
          : module
      )
    );
  };

  const handleModuleBehaviorChange = (moduleId: string, behavior: AssistantSimpleBehavior) => {
    setModules((prev) =>
      prev.map((module) => {
        if (module.id !== moduleId || module.builtIn || module.kind !== "simple") {
          return module;
        }
        return {
          ...module,
          simpleBehavior: behavior,
          defaultPrompt: getDefaultPromptTemplateForBehavior(behavior),
          inputPlaceholder: getDefaultAssistantModuleInputPlaceholder({
            kind: "simple",
            simpleBehavior: behavior,
          }),
          promptDescription: undefined,
        };
      })
    );
  };

  const handleModuleIconChange = (moduleId: string, iconKey: AssistantModuleIconKey) => {
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? { ...module, iconKey }
          : module
      )
    );
  };

  const handleSaveModule = async (moduleId: string) => {
    setModuleSavingId(moduleId);
    setMessage(null);
    const target = modules.find((module) => module.id === moduleId);
    if (!target) {
      setModuleSavingId(null);
      return;
    }

    if (!target.label.trim()) {
      setMessage({ type: "error", text: "模块名称不能为空" });
      setModuleSavingId(null);
      return;
    }

    if (modules.filter((module) => module.enabled).length === 0) {
      setMessage({ type: "error", text: "至少保留一个主页功能模块" });
      setModuleSavingId(null);
      return;
    }

    const nextModules = modules.map((module) =>
      module.id === moduleId
        ? {
            ...module,
            label: module.label.trim(),
            description: module.description.trim(),
            inputPlaceholder: module.inputPlaceholder?.trim()
              || getDefaultAssistantModuleInputPlaceholder(module),
          }
        : module
    );
    await persistModules(nextModules, "模块已保存");
    setModuleSavingId(null);
  };

  const handleResetModules = async () => {
    const confirmed = confirmAction(
      "将恢复内置功能模块为默认配置，自定义模块不会受影响，是否继续？",
      { defaultWhenUnavailable: true }
    );
    if (!confirmed) return;
    setMessage(null);
    try {
      const restoredModules = await restoreDefaultAssistantModules();
      setModules(restoredModules);
      setExpandedModuleId(null);
      setDeletedModuleCount(getDeletedAssistantModules().length);
      setMessage({ type: "success", text: "内置模块已恢复默认，自定义模块已保留" });
    } catch {
      setMessage({ type: "error", text: "恢复默认模块失败，请重试" });
    }
  };

  const handleRestoreDeletedModule = async () => {
    setMessage(null);
    try {
      const restored = await restoreLastDeletedAssistantModule();
      if (!restored) {
        setMessage({ type: "error", text: "没有可恢复的已删除模块" });
        return;
      }

      if (restored.module.promptKey) {
        if (restored.promptOverride) {
          await savePrompt(restored.module.promptKey, restored.promptOverride);
        } else {
          await resetPrompt(restored.module.promptKey);
        }
      }

      const restoredModules = getAllAssistantModules();
      setModules(restoredModules);
      setExpandedModuleId(restored.module.id);
      setDeletedModuleCount(getDeletedAssistantModules().length);
      setMessage({ type: "success", text: `已恢复模块：${restored.module.label}` });
    } catch {
      setMessage({ type: "error", text: "恢复已删除模块失败，请重试" });
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
    await runModelProbeForProfile(profile);
  };

  const toggleExpand = (profileId: string) => {
    setExpandedProfileId((prev) => (prev === profileId ? null : profileId));
    setShowApiKeyFor(null);
  };

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const systemProxyValidationError = getSystemProxyValidationError(systemProxy);
  const officeHostSummary = getOfficeHostSummary();
  const promptDefinitions = getPromptDefinitions(modules);
  const selectedPromptDefinition =
    promptDefinitions.find((def) => def.key === selectedPromptKey) || promptDefinitions[0];
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
    const confirmed = confirmAction("将恢复所有提示词为默认值，是否继续？", {
      defaultWhenUnavailable: true,
    });
    if (!confirmed) return;
    setPromptSaving(true);
    setMessage(null);
    try {
      await resetAllPrompts();
      const nextPromptKey = promptDefinitions[0]?.key || "agent_planner_v2";
      setSelectedPromptKey(nextPromptKey);
      setPromptDraft(getDefaultPrompt(nextPromptKey));
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
              setSettingsTab(data.value as "api" | "modules" | "prompts");
            }}
          >
            <Tab value="api">API</Tab>
            <Tab value="modules">模块</Tab>
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
              <Text className={styles.activeHint}>当前：{getProfileDisplayName(activeProfile)}</Text>
              <div className={styles.actionButtons}>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleAddProfile}>
                  添加配置
                </Button>
              </div>
            </div>

            <Card className={mergeClasses(styles.card, styles.cardStatic)}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderInfo}>
                  <Text className={styles.cardHeaderTitle}>运行诊断</Text>
                  <Text className={styles.cardHeaderMeta}>本地服务、证书、宿主状态</Text>
                </div>
                <div className={styles.headerActions}>
                  <Button
                    size="small"
                    appearance="secondary"
                    className={styles.smallButton}
                    icon={<ArrowSync24Regular />}
                    onClick={refreshRuntimeDiagnostics}
                    disabled={diagnosticsLoading}
                  >
                    {diagnosticsLoading ? "刷新中..." : "刷新"}
                  </Button>
                  <Button
                    size="small"
                    appearance="subtle"
                    className={styles.smallButton}
                    aria-expanded={diagnosticsExpanded}
                    onClick={() => setDiagnosticsExpanded((prev) => !prev)}
                  >
                    {diagnosticsExpanded ? "收起" : "展开"}
                  </Button>
                </div>
              </div>
              {diagnosticsExpanded && (
              <div className={styles.cardContent}>
                <div className={styles.diagnosticsGrid}>
                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>服务</Text>
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
                    <Text className={styles.diagnosticLabel}>端口 / 证书</Text>
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
                    <Text className={styles.diagnosticLabel}>证书</Text>
                    <Text className={styles.diagnosticValue}>
                      {formatDateTime(runtimeDiagnostics?.certificate.validTo)}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      证书路径：{runtimeDiagnostics?.certificate.certPath || "未检测到"}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>Manifest / Office</Text>
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
                    <Text className={styles.diagnosticLabel}>当前模型</Text>
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
                    <Text className={styles.diagnosticLabel}>代理</Text>
                    <Text className={styles.diagnosticValue}>
                      {runtimeDiagnostics?.outboundProxy?.enabled
                        ? `${runtimeDiagnostics.outboundProxy?.protocol || "代理"} 已启用`
                        : "未启用"}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      地址：{runtimeDiagnostics?.outboundProxy?.endpoint || "未配置"}
                      {"\n"}
                      认证：{runtimeDiagnostics?.outboundProxy?.hasAuth ? "已配置" : "未配置"}
                      {"\n"}
                      目标过滤：{runtimeDiagnostics?.security.blocksPrivateAddresses ? "拦截 localhost / 内网地址" : "未启用"}
                      {"\n"}
                      静态解析：{runtimeDiagnostics?.security.staticTargetResolution ? "已启用" : "未启用"}
                    </Text>
                  </div>

                  <div className={styles.diagnosticTile}>
                    <Text className={styles.diagnosticLabel}>安全存储</Text>
                    <Text className={styles.diagnosticValue}>
                      {runtimeDiagnostics?.storage.backend || "服务不可用时回退到 localStorage"}
                    </Text>
                    <Text className={styles.diagnosticMeta}>
                      API 鉴权：{runtimeDiagnostics?.security.clientHeaderRequired ? "要求本加载项请求头" : "未启用"}
                      {"\n"}
                      来源限制：{runtimeDiagnostics?.security.sameOriginOnly ? "仅本加载项同源请求" : "未启用"}
                      {"\n"}
                      代理方法：{runtimeDiagnostics?.security.proxyMethod || "未检测到"}
                      {"\n"}
                      存储文件：{runtimeDiagnostics?.storage.filePath || "未检测到"}
                      {"\n"}
                      文件状态：{runtimeDiagnostics?.storage.exists ? "已创建" : "未创建"}
                    </Text>
                  </div>
                </div>

                <Text className={styles.diagnosticsNote}>
                  {diagnosticsError
                    ? `诊断不可用：${diagnosticsError}。`
                    : "优先写入本地服务安全存储，服务不可用时回退浏览器本地存储。"}
                </Text>
              </div>
              )}
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderInfo}>
                  <Text className={styles.cardHeaderTitle}>系统代理</Text>
                  <Text className={styles.cardHeaderMeta}>控制本地服务出站连接</Text>
                </div>
              </div>
              <div className={styles.cardContent}>
                <div className={styles.formGrid}>
                  <Field className={styles.fieldSpanFull}>
                    <Switch
                      checked={systemProxy.enabled}
                      label="启用系统代理"
                      onChange={(_, data) =>
                        setSystemProxy((prev) => ({
                          ...prev,
                          enabled: data.checked,
                        }))
                      }
                    />
                    <Text className={styles.hint}>
                      开启后，模型请求走本地服务代理。
                    </Text>
                  </Field>

                  <Field label="代理类型">
                    <Dropdown
                      className={styles.modelDropdown}
                      value={systemProxyTypeOptions.find((item) => item.value === systemProxy.protocol)?.label || "HTTP"}
                      onOptionSelect={(_, data) => {
                        if (data.optionValue) {
                          handleSystemProxyProtocolChange(data.optionValue as SystemProxyProtocol);
                        }
                      }}
                    >
                      {systemProxyTypeOptions.map((option) => (
                        <Option key={option.value} value={option.value}>
                          {option.label}
                        </Option>
                      ))}
                    </Dropdown>
                    <Text className={styles.hint}>HTTP / SOCKS5</Text>
                  </Field>

                  <Field label="代理端口" required={systemProxy.enabled}>
                    <Input
                      className={styles.input}
                      type="number"
                      min="1"
                      max="65535"
                      value={String(systemProxy.port)}
                      onChange={(_, data) => handleSystemProxyPortChange(data.value)}
                      placeholder={String(systemProxy.protocol === "http" ? DEFAULT_HTTP_PROXY_PORT : DEFAULT_SOCKS5_PROXY_PORT)}
                      spellCheck={false}
                    />
                    <Text className={styles.hint}>1-65535</Text>
                  </Field>

                  <Field className={styles.fieldSpanFull} label="代理主机" required={systemProxy.enabled}>
                    <Input
                      className={styles.input}
                      value={systemProxy.host}
                      onChange={(_, data) => handleSystemProxyFieldChange("host", data.value)}
                      placeholder="127.0.0.1 或 proxy.company.local"
                      spellCheck={false}
                    />
                    <Text className={styles.hint}>
                      仅填写主机名或 IP，不要包含协议、路径或账号信息；会在连接前先做静态 DNS 解析，并拦截 localhost、私网与链路本地地址。
                    </Text>
                  </Field>

                  <Field label="用户名">
                    <Input
                      className={styles.input}
                      value={systemProxy.username || ""}
                      onChange={(_, data) => handleSystemProxyFieldChange("username", data.value)}
                      placeholder="可选"
                      spellCheck={false}
                    />
                  </Field>

                  <Field label="密码">
                    <div className={styles.inputWrapper}>
                      <Input
                        className={styles.input}
                        type={showProxyPassword ? "text" : "password"}
                        value={systemProxy.password || ""}
                        onChange={(_, data) => handleSystemProxyFieldChange("password", data.value)}
                        placeholder="可选"
                        spellCheck={false}
                      />
                      <Button
                        className={styles.eyeButton}
                        icon={showProxyPassword ? <EyeOff24Regular /> : <Eye24Regular />}
                        appearance="subtle"
                        onClick={() => setShowProxyPassword((prev) => !prev)}
                      />
                    </div>
                    <Text className={styles.hint}>密码优先写入本地服务安全存储。</Text>
                  </Field>
                </div>

                <Text className={styles.hint}>
                  {systemProxyValidationError || "安全限制默认开启：拒绝转发到 localhost、本机回环、私网、链路本地和保留地址；目标主机名会先静态解析后再建立连接。"}
                </Text>

                <div className={styles.cardActions}>
                  <Button
                    className={styles.primaryButton}
                    appearance="primary"
                    icon={<Save24Regular />}
                    onClick={handleSaveSystemProxy}
                    disabled={proxySaving}
                  >
                    {proxySaving ? "保存中..." : "保存系统代理"}
                  </Button>
                </div>
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
                const displayName = getProfileDisplayName(profile, `配置 ${index + 1}`);
                const connectionResult = connectionResults[profile.id];
                const modelProbeResult = modelProbeResults[profile.id];
                const probeValidationError = getProbeValidationError(profile);
                const modelDropdownOptions = modelProbeResult?.models || [];
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
                            <Text className={styles.hint}>AI 服务商</Text>
                          </Field>

                          <Field label="最大输出 (max_tokens)">
                            <Input
                              className={styles.input}
                              type="number"
                              value={profile.maxOutputTokens !== undefined ? String(profile.maxOutputTokens) : ""}
                              onChange={(_, data) => handleMaxOutputTokensChange(profile.id, data.value)}
                              placeholder={`留空默认 ${DEFAULT_MAX_OUTPUT_TOKENS}`}
                            />
                            <Text className={styles.hint}>默认 {DEFAULT_MAX_OUTPUT_TOKENS}。</Text>
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
                            <Text className={styles.hint}>默认 {DEFAULT_REQUEST_TIMEOUT_MS} ms。</Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="模型名称" required>
                            <div className={styles.inputWrapper}>
                              <Input
                                className={styles.input}
                                value={profile.model}
                                onChange={(_, data) => handleProfileChange(profile.id, "model", data.value)}
                                placeholder="输入模型名称"
                                spellCheck={false}
                              />
                              <Button
                                className={styles.eyeButton}
                                appearance="subtle"
                                icon={
                                  probingProfileId === profile.id
                                    ? <Spinner size="tiny" />
                                    : <ArrowSync24Regular />
                                }
                                onClick={() => handleModelProbe(profile.id)}
                                disabled={probingProfileId === profile.id || Boolean(probeValidationError)}
                                title={probeValidationError || "刷新模型列表"}
                                aria-label="刷新模型列表"
                              />
                            </div>
                            {modelDropdownOptions.length > 0 && (
                              <Dropdown
                                className={styles.modelDropdown}
                                value={profile.model || "选择模型"}
                                onOptionSelect={(_, data) => {
                                  if (data.optionValue) {
                                    handleProfileChange(profile.id, "model", data.optionValue);
                                  }
                                }}
                              >
                                {modelDropdownOptions.map((model) => (
                                  <Option key={model} value={model}>
                                    {model}
                                  </Option>
                                ))}
                              </Dropdown>
                            )}
                            <Text className={styles.hint}>
                              示例：{modelExamples[profile.apiType]}
                              {probeValidationError ? `；${probeValidationError}` : ""}
                            </Text>
                          </Field>

                          <Field label="Planner 模型">
                            <Input
                              className={styles.input}
                              value={profile.plannerModel ?? ""}
                              onChange={(_, data) => handleProfileChange(profile.id, "plannerModel", data.value)}
                              placeholder="留空则跟随主模型"
                              spellCheck={false}
                            />
                            <Text className={styles.hint}>规划阶段，可留空。</Text>
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
                            <Text className={styles.hint}>0-2，规划建议偏低。</Text>
                          </Field>

                          <Field label="Writer 模型">
                            <Input
                              className={styles.input}
                              value={profile.writerModel ?? ""}
                              onChange={(_, data) => handleProfileChange(profile.id, "writerModel", data.value)}
                              placeholder="留空则跟随主模型"
                              spellCheck={false}
                            />
                            <Text className={styles.hint}>写作阶段，可留空。</Text>
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
                            <Text className={styles.hint}>0-2，写作建议中等。</Text>
                          </Field>

                          <Field label="Reviewer 模型">
                            <Input
                              className={styles.input}
                              value={profile.reviewerModel ?? ""}
                              onChange={(_, data) => handleProfileChange(profile.id, "reviewerModel", data.value)}
                              placeholder="留空则跟随主模型"
                              spellCheck={false}
                            />
                            <Text className={styles.hint}>审阅阶段，可留空。</Text>
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
                            <Text className={styles.hint}>0-2，审阅建议偏低。</Text>
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
                            <Text className={styles.hint}>并发 1-6。</Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="API 密钥" required>
                            <div className={styles.inputWrapper}>
                              <Input
                                className={styles.input}
                                type={showKey ? "text" : "password"}
                                value={profile.apiKey}
                                onChange={(_, data) => handleProfileChange(profile.id, "apiKey", data.value)}
                                placeholder="输入您的 API 密钥"
                                spellCheck={false}
                              />
                              <Button
                                className={styles.eyeButton}
                                icon={showKey ? <EyeOff24Regular /> : <Eye24Regular />}
                                appearance="subtle"
                                onClick={() => setShowApiKeyFor(showKey ? null : profile.id)}
                              />
                            </div>
                            <Text className={styles.hint}>仅本地保存，优先使用安全存储。</Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="API 端点" required>
                            <Input
                              className={styles.input}
                              value={profile.apiEndpoint}
                              onChange={(_, data) => handleProfileChange(profile.id, "apiEndpoint", data.value)}
                              placeholder="https://api.example.com/"
                              spellCheck={false}
                            />
                            <Text className={styles.hint}>
                              Use base URL only (e.g. {endpointExamples[profile.apiType]}). Path suffix is
                              auto-filled by channel type.
                            </Text>
                          </Field>
                        </div>

                        <div className={styles.profileToolsCard}>
                          <Text weight="semibold">测试</Text>
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
                                模型列表：{modelProbeResult.ok ? "已更新" : "获取失败"}
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
                API 快速提示
              </Text>
              <Text className={styles.infoText}>
                新建一条配置，补齐密钥、端点和模型，测试通过后再启用。
              </Text>
            </div>
          </>
        ) : settingsTab === "modules" ? (
          <>
            <div className={styles.actionRow}>
              <Text className={styles.activeHint}>
                已启用 {modules.filter((module) => module.enabled).length} 个模块
              </Text>
              <div className={styles.actionButtons}>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleAddModule}>
                  添加模块
                </Button>
                <Button
                  appearance="secondary"
                  onClick={handleRestoreDeletedModule}
                  disabled={deletedModuleCount === 0}
                >
                  {deletedModuleCount > 0 ? `恢复最近删除 (${deletedModuleCount})` : "恢复最近删除"}
                </Button>
                <Button appearance="secondary" icon={<Delete24Regular />} onClick={handleResetModules}>
                  恢复内置默认
                </Button>
              </div>
            </div>

            <div className={styles.profilesList}>
              {modules.map((module) => {
                const isExpanded = module.id === expandedModuleId;
                const ModuleIcon = getAssistantModuleIcon(module);
                const selectedIconOption = ASSISTANT_MODULE_ICON_OPTIONS.find(
                  (option) => option.key === module.iconKey
                );
                return (
                  <Card
                    key={module.id}
                    className={mergeClasses(styles.card, isExpanded && styles.cardExpanded)}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.cardHeaderInfo}>
                        <div className={styles.moduleTitleRow}>
                          {ModuleIcon && (
                            <span className={styles.moduleTitleIcon}>
                              <ModuleIcon />
                            </span>
                          )}
                          <Text className={styles.cardHeaderTitle}>{module.label}</Text>
                        </div>
                        <Text className={styles.cardHeaderMeta}>
                          {getAssistantModuleModeLabel(module)}
                          {" · "}
                          {module.builtIn ? "内置模块" : "自定义模块"}
                        </Text>
                      </div>
                      <div className={styles.cardHeaderStatus}>
                        <div className={styles.headerActions}>
                          <Button
                            size="small"
                            appearance="subtle"
                            className={styles.smallButton}
                            onClick={() =>
                              setExpandedModuleId((prev) => (prev === module.id ? null : module.id))
                            }
                          >
                            {isExpanded ? "收起" : "编辑"}
                          </Button>
                          <Button
                            size="small"
                            appearance="subtle"
                            className={styles.smallButton}
                            icon={<Delete24Regular />}
                            onClick={() => handleDeleteModule(module.id)}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className={styles.cardContent}>
                        <div className={styles.formGrid}>
                          <Field className={styles.fieldSpanFull} label="模块名称" required>
                            <Input
                              className={styles.input}
                              value={module.label}
                              onChange={(_, data) => handleModuleFieldChange(module.id, "label", data.value)}
                              placeholder="输入模块名称"
                            />
                          </Field>

                          <Field label="显示顺序">
                            <Input
                              className={styles.input}
                              type="number"
                              min="1"
                              value={String(module.order)}
                              onChange={(_, data) => handleModuleOrderChange(module.id, data.value)}
                            />
                              <Text className={styles.hint}>越小越靠前。</Text>
                          </Field>

                          {!module.builtIn && module.kind === "simple" && (
                            <Field label="处理方式">
                              <Dropdown
                                className={styles.modelDropdown}
                                value={
                                  customModuleBehaviorOptions.find((option) => option.value === module.simpleBehavior)?.label
                                  || customModuleBehaviorOptions[0].label
                                }
                                onOptionSelect={(_, data) => {
                                  if (data.optionValue) {
                                    handleModuleBehaviorChange(
                                      module.id,
                                      data.optionValue as AssistantSimpleBehavior
                                    );
                                  }
                                }}
                              >
                                {customModuleBehaviorOptions.map((option) => (
                                  <Option key={option.value} value={option.value}>
                                    {option.label}
                                  </Option>
                                ))}
                              </Dropdown>
                              <Text className={styles.hint}>文本处理 / 翻译 / 风格模板。</Text>
                            </Field>
                          )}

                          {!module.builtIn && (
                            <Field label="模块图标">
                              <div className={styles.iconPickerCurrent}>
                                {ModuleIcon && (
                                  <span className={styles.iconPickerIcon}>
                                    <ModuleIcon />
                                  </span>
                                )}
                                <span>当前图标：{selectedIconOption?.label || "未选择"}</span>
                              </div>
                              <div className={styles.iconPickerGrid}>
                                {ASSISTANT_MODULE_ICON_OPTIONS.map((option) => {
                                  const OptionIcon = option.Icon;
                                  const selected = option.key === module.iconKey;
                                  return (
                                    <button
                                      key={option.key}
                                      type="button"
                                      className={mergeClasses(
                                        styles.iconPickerButton,
                                        selected && styles.iconPickerButtonSelected
                                      )}
                                      onClick={() => handleModuleIconChange(
                                        module.id,
                                        option.key as AssistantModuleIconKey
                                      )}
                                      aria-pressed={selected}
                                      title={option.label}
                                    >
                                      <span className={styles.iconPickerIcon}>
                                        <OptionIcon />
                                      </span>
                                      <span className={styles.iconPickerLabel}>{option.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              <Text className={styles.hint}>选择一个图标即可。</Text>
                            </Field>
                          )}

                          <Field className={styles.fieldSpanFull}>
                            <Switch
                              checked={module.enabled}
                              label="显示在主页功能区域"
                              onChange={(_, data) => handleModuleToggle(module.id, data.checked)}
                            />
                            <Text className={styles.hint}>关闭后不显示在主页。</Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="模块说明">
                            <Textarea
                              className={styles.compactTextarea}
                              value={module.description}
                              onChange={(_, data) => handleModuleFieldChange(module.id, "description", data.value)}
                              appearance="filled-lighter"
                            />
                          </Field>

                          <Field className={styles.fieldSpanFull} label="输入框占位文案">
                            <Input
                              className={styles.input}
                              value={module.inputPlaceholder || ""}
                              onChange={(_, data) => handleModuleFieldChange(module.id, "inputPlaceholder", data.value)}
                              placeholder={getDefaultAssistantModuleInputPlaceholder(module)}
                            />
                          </Field>
                        </div>

                        <div className={styles.infoCard}>
                          <Text weight="semibold" style={{ marginBottom: "8px", display: "block" }}>
                            提示词位置
                          </Text>
                          <Text className={styles.infoText}>
                            {module.kind === "workflow"
                              ? "该流程的系统提示词在“提示词”页签维护。"
                              : "保存后可在“提示词”页签继续微调。"}
                          </Text>
                        </div>

                        <div className={styles.cardActions}>
                          <Button
                            className={styles.primaryButton}
                            appearance="primary"
                            icon={<Save24Regular />}
                            onClick={() => handleSaveModule(module.id)}
                            disabled={moduleSavingId === module.id}
                          >
                            {moduleSavingId === module.id ? "保存中..." : "保存模块"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <Card className={mergeClasses(styles.card, styles.promptCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderInfo}>
                <Text className={styles.cardHeaderTitle}>提示词设置</Text>
                <Text className={styles.cardHeaderMeta}>查看和修改系统提示词</Text>
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
                  全部默认
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
                  {promptDefinitions.map((def) => (
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
                  变量：{selectedPromptDefinition.variables.map((v) => `{{${v.name}}}`).join("、")}
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

              <Text className={styles.hint}>保存后，下次调用对应流程时生效。</Text>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};


export default Settings;
