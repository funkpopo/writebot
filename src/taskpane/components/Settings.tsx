import * as React from "react";
import { useState, useEffect } from "react";
import {
  MessageBar,
  MessageBarBody,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  saveSettingsStore,
  loadSettingsStore,
  getApiDefaults,
  getAISettingsValidationError,
  getDefaultSystemProxyPort,
  getDefaultSystemProxySettings,
  getSystemProxyValidationError,
  createProfile,
  AIProfile,
  APIType,
  SystemProxyProtocol,
  SystemProxySettings,
} from "../../utils/storageService";
import { useStyles } from "./settings/settingsStyles";
import {
  syncActiveProfileToAIConfig,
  getProbeValidationError,
  parseOptionalInt,
  confirmAction,
  getOfficeHostSummary,
} from "./settings/settingsShared";
import { ApiSettingsTab } from "./settings/ApiSettingsTab";
import { ModulesTab } from "./settings/ModulesTab";
import { PromptsTab } from "./settings/PromptsTab";
import { DEFAULT_MAX_OUTPUT_TOKENS, normalizeMaxOutputTokens } from "../../utils/tokenUtils";
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
  getDefaultAssistantModuleInputPlaceholder,
  getDefaultPromptTemplateForBehavior,
  restoreDefaultAssistantModules,
  restoreLastDeletedAssistantModule,
  saveAssistantModules,
  stashDeletedAssistantModule,
} from "../../utils/assistantModuleService";
import {
  loadRuntimeDiagnostics,
  probeAIProfileModels,
  testAIProfileConnection,
  type ConnectionTestResult,
  type ModelProbeResult,
  type RuntimeDiagnostics,
} from "../../utils/settingsDiagnostics";

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
      setSelectedPromptKey(promptDefinitions[0]!.key);
    }
  }, [modules, selectedPromptKey]);

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
          <ApiSettingsTab
          profiles={profiles}
          activeProfileId={activeProfileId}
          activeProfile={activeProfile}
          expandedProfileId={expandedProfileId}
          showApiKeyFor={showApiKeyFor}
          savingId={savingId}
          testingProfileId={testingProfileId}
          probingProfileId={probingProfileId}
          connectionResults={connectionResults}
          modelProbeResults={modelProbeResults}
          systemProxy={systemProxy}
          showProxyPassword={showProxyPassword}
          proxySaving={proxySaving}
          setSystemProxy={setSystemProxy}
          setShowProxyPassword={setShowProxyPassword}
          runtimeDiagnostics={runtimeDiagnostics}
          diagnosticsLoading={diagnosticsLoading}
          diagnosticsError={diagnosticsError}
          diagnosticsExpanded={diagnosticsExpanded}
          setDiagnosticsExpanded={setDiagnosticsExpanded}
          refreshRuntimeDiagnostics={refreshRuntimeDiagnostics}
          systemProxyValidationError={systemProxyValidationError}
          officeHostSummary={officeHostSummary}
          handleAddProfile={handleAddProfile}
          handleSaveSystemProxy={handleSaveSystemProxy}
          handleSystemProxyProtocolChange={handleSystemProxyProtocolChange}
          handleSystemProxyPortChange={handleSystemProxyPortChange}
          handleSystemProxyFieldChange={handleSystemProxyFieldChange}
          handleSetActive={handleSetActive}
          toggleExpand={toggleExpand}
          handleDeleteProfile={handleDeleteProfile}
          handleApiTypeChange={handleApiTypeChange}
          handleMaxOutputTokensChange={handleMaxOutputTokensChange}
          handleProfileNumberChange={handleProfileNumberChange}
          handleProfileChange={handleProfileChange}
          handleModelProbe={handleModelProbe}
          handleConnectionTest={handleConnectionTest}
          setShowApiKeyFor={setShowApiKeyFor}
          handleSaveProfile={handleSaveProfile}
          />
        ) : settingsTab === "modules" ? (
          <ModulesTab
          modules={modules}
          expandedModuleId={expandedModuleId}
          setExpandedModuleId={setExpandedModuleId}
          moduleSavingId={moduleSavingId}
          deletedModuleCount={deletedModuleCount}
          handleAddModule={handleAddModule}
          handleRestoreDeletedModule={handleRestoreDeletedModule}
          handleResetModules={handleResetModules}
          handleDeleteModule={handleDeleteModule}
          handleModuleFieldChange={handleModuleFieldChange}
          handleModuleOrderChange={handleModuleOrderChange}
          handleModuleToggle={handleModuleToggle}
          handleModuleBehaviorChange={handleModuleBehaviorChange}
          handleModuleIconChange={handleModuleIconChange}
          handleSaveModule={handleSaveModule}
          />
        ) : (
          <PromptsTab
          promptDefinitions={promptDefinitions}
          selectedPromptDefinition={selectedPromptDefinition}
          selectedPromptKey={selectedPromptKey}
          setSelectedPromptKey={setSelectedPromptKey}
          promptDraft={promptDraft}
          setPromptDraft={setPromptDraft}
          promptSaving={promptSaving}
          promptIsCustomized={promptIsCustomized}
          handleSavePrompt={handleSavePrompt}
          handleResetPrompt={handleResetPrompt}
          handleResetAllPrompts={handleResetAllPrompts}
          />
        )}
      </div>
    </div>
  );
};

export default Settings;
