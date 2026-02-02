import * as React from "react";
import { useState, useEffect } from "react";
import {
  Button,
  Input,
  makeStyles,
  tokens,
  Card,
  Text,
  MessageBar,
  MessageBarBody,
  Dropdown,
  Option,
  Field,
} from "@fluentui/react-components";
import {
  Save24Regular,
  Delete24Regular,
  Eye24Regular,
  EyeOff24Regular,
  Add24Regular,
} from "@fluentui/react-icons";
import {
  saveSettingsStore,
  loadSettingsStore,
  clearSettings,
  getApiDefaults,
  getAISettingsValidationError,
  createProfile,
  AIProfile,
  APIType,
} from "../../utils/storageService";
import { setAIConfig } from "../../utils/aiService";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    textAlign: "center",
    padding: "16px 0",
  },
  headerTitle: {
    fontSize: "20px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    marginBottom: "4px",
  },
  headerSubtitle: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  actionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  activeHint: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
  actionButtons: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  profilesList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    borderRadius: "16px",
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  cardHeader: {
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  cardHeaderInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  cardHeaderTitle: {
    fontSize: "14px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  cardHeaderMeta: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  cardHeaderStatus: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
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
    gap: "6px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  cardContent: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  inputWrapper: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  input: {
    flex: 1,
    "& input": {
      borderRadius: "8px",
    },
  },
  eyeButton: {
    minWidth: "36px",
    height: "36px",
    borderRadius: "8px",
  },
  smallButton: {
    borderRadius: "8px",
    height: "32px",
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
    gap: "8px",
  },
  primaryButton: {
    borderRadius: "12px",
    height: "40px",
  },
  infoCard: {
    borderRadius: "16px",
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "16px",
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
});

// API 类型选项
const apiTypeOptions: { value: APIType; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
];

// API 端点格式示例
const endpointExamples: Record<APIType, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
};

// 模型名称示例
const modelExamples: Record<APIType, string> = {
  openai: "gpt-4o, gpt-4o-mini, gpt-4-turbo",
  anthropic: "claude-3-5-sonnet-20241022, claude-3-opus-20240229",
  gemini: "gemini-pro, gemini-1.5-pro, gemini-1.5-flash",
};

const Settings: React.FC = () => {
  const styles = useStyles();
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [showApiKeyFor, setShowApiKeyFor] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const store = loadSettingsStore();
    setProfiles(store.profiles);
    setActiveProfileId(store.activeProfileId);
    setExpandedProfileId(null);

    const active = store.profiles.find((profile) => profile.id === store.activeProfileId)
      || store.profiles[0];
    if (active) {
      setAIConfig({
        apiType: active.apiType,
        apiKey: active.apiKey,
        apiEndpoint: active.apiEndpoint,
        model: active.model,
      });
    }
  }, []);

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
      const store = loadSettingsStore();
      setProfiles(store.profiles);
      setActiveProfileId(store.activeProfileId);

      const active = store.profiles.find((profile) => profile.id === store.activeProfileId)
        || store.profiles[0];
      if (active) {
        setAIConfig({
          apiType: active.apiType,
          apiKey: active.apiKey,
          apiEndpoint: active.apiEndpoint,
          model: active.model,
        });
      }

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
      const store = loadSettingsStore();
      setProfiles(store.profiles);
      setActiveProfileId(store.activeProfileId);
      setExpandedProfileId(null);
      const active = store.profiles.find((profile) => profile.id === store.activeProfileId)
        || store.profiles[0];
      if (active) {
        setAIConfig({
          apiType: active.apiType,
          apiKey: active.apiKey,
          apiEndpoint: active.apiEndpoint,
          model: active.model,
        });
      }
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

    const nextProfiles = profiles.map((item) =>
      item.id === profileId
        ? { ...item, name: item.name.trim() }
        : item
    );
    await persistStore(nextProfiles, activeProfileId, "配置已保存");
    setSavingId(null);
  };

  const handleSetActive = async (profileId: string) => {
    if (profileId === activeProfileId) return;
    setMessage(null);
    setActiveProfileId(profileId);
    await persistStore(profiles, profileId, "已启用该配置");
  };

  const toggleExpand = (profileId: string) => {
    setExpandedProfileId((prev) => (prev === profileId ? null : profileId));
    setShowApiKeyFor(null);
  };

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text className={styles.headerTitle}>API 设置</Text>
        <Text className={styles.headerSubtitle}>配置多个 AI 服务并随时切换</Text>
      </div>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actionRow}>
        <Text className={styles.activeHint}>
          当前启用：{activeProfile?.name || "未选择"}
        </Text>
        <div className={styles.actionButtons}>
          <Button
            appearance="primary"
            icon={<Add24Regular />}
            onClick={handleAddProfile}
          >
            添加配置
          </Button>
          <Button
            appearance="secondary"
            icon={<Delete24Regular />}
            onClick={handleReset}
          >
            重置全部
          </Button>
        </div>
      </div>

      <div className={styles.profilesList}>
        {profiles.map((profile, index) => {
          const isActive = profile.id === activeProfileId;
          const isExpanded = profile.id === expandedProfileId;
          const validationError = getAISettingsValidationError(profile);
          const showKey = showApiKeyFor === profile.id;
          const displayName = profile.name?.trim() || `配置 ${index + 1}`;
          return (
            <Card key={profile.id} className={styles.card}>
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
                  <Field label="配置名称">
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
                    <Text className={styles.hint}>
                      选择您要使用的 AI 服务提供商
                    </Text>
                  </Field>

                  <Field label="API 密钥" required>
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
                    <Text className={styles.hint}>
                      您的 API 密钥仅保存在本地
                    </Text>
                  </Field>

                  <Field label="API 端点" required>
                    <Input
                      className={styles.input}
                      value={profile.apiEndpoint}
                      onChange={(_, data) => handleProfileChange(profile.id, "apiEndpoint", data.value)}
                      placeholder="输入 API 端点地址"
                    />
                    <Text className={styles.hint}>
                      格式示例：{endpointExamples[profile.apiType]}
                    </Text>
                  </Field>

                  <Field label="模型名称" required>
                    <Input
                      className={styles.input}
                      value={profile.model}
                      onChange={(_, data) => handleProfileChange(profile.id, "model", data.value)}
                      placeholder="输入模型名称"
                    />
                    <Text className={styles.hint}>
                      可用模型示例：{modelExamples[profile.apiType]}
                    </Text>
                  </Field>

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
          <li className={styles.infoListItem}>Google: aistudio.google.com</li>
        </ul>
        <Text className={styles.infoText}>
          3. 填入 API 密钥、端点地址和模型名称
          <br />
          4. 点击“启用”切换当前使用配置，点击“保存配置”完成保存
        </Text>
      </div>
    </div>
  );
};

export default Settings;
