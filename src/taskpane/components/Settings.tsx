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
} from "@fluentui/react-icons";
import {
  saveSettings,
  loadSettings,
  clearSettings,
  getDefaultSettings,
  AISettings,
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
  card: {
    borderRadius: "16px",
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  cardHeader: {
    padding: "16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  cardContent: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
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
  buttonGroup: {
    display: "flex",
    gap: "12px",
  },
  primaryButton: {
    flex: 1,
    borderRadius: "12px",
    height: "40px",
  },
  secondaryButton: {
    borderRadius: "12px",
    height: "40px",
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
  const [settings, setSettings] = useState<AISettings>(getDefaultSettings());
  const [showApiKey, setShowApiKey] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    // 同步到 AI 服务
    setAIConfig(loaded);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveSettings(settings);
      setAIConfig(settings);
      setMessage({ type: "success", text: "设置已保存" });
    } catch (error) {
      setMessage({ type: "error", text: "保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      await clearSettings();
      const defaults = getDefaultSettings();
      setSettings(defaults);
      setAIConfig(defaults);
      setMessage({ type: "success", text: "设置已重置" });
    } catch (error) {
      setMessage({ type: "error", text: "重置失败，请重试" });
    }
  };

  const handleChange = (field: keyof AISettings, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  // 处理 API 类型切换
  const handleApiTypeChange = (newType: APIType) => {
    setSettings((prev) => ({
      ...prev,
      apiType: newType,
    }));
  };

  const getApiTypeLabel = (value: APIType) => {
    const option = apiTypeOptions.find((o) => o.value === value);
    return option?.label || value;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text className={styles.headerTitle}>API 设置</Text>
        <Text className={styles.headerSubtitle}>配置您的 AI 服务提供商</Text>
      </div>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}

      <Card className={styles.card}>
        <div className={styles.cardHeader}>
          <Text weight="semibold">AI API 配置</Text>
        </div>
        <div className={styles.cardContent}>
          <Field label="API 类型" required>
            <Dropdown
              className={styles.modelDropdown}
              value={getApiTypeLabel(settings.apiType)}
              onOptionSelect={(_, data) => {
                if (data.optionValue) {
                  handleApiTypeChange(data.optionValue as APIType);
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
                type={showApiKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(_, data) => handleChange("apiKey", data.value)}
                placeholder="输入您的 API 密钥"
              />
              <Button
                className={styles.eyeButton}
                icon={showApiKey ? <EyeOff24Regular /> : <Eye24Regular />}
                appearance="subtle"
                onClick={() => setShowApiKey(!showApiKey)}
              />
            </div>
            <Text className={styles.hint}>
              您的 API 密钥仅保存在本地浏览器中
            </Text>
          </Field>

          <Field label="API 端点" required>
            <Input
              className={styles.input}
              value={settings.apiEndpoint}
              onChange={(_, data) => handleChange("apiEndpoint", data.value)}
              placeholder="输入 API 端点地址"
            />
            <Text className={styles.hint}>
              格式示例：{endpointExamples[settings.apiType]}
            </Text>
          </Field>

          <Field label="模型名称" required>
            <Input
              className={styles.input}
              value={settings.model}
              onChange={(_, data) => handleChange("model", data.value)}
              placeholder="输入模型名称"
            />
            <Text className={styles.hint}>
              可用模型示例：{modelExamples[settings.apiType]}
            </Text>
          </Field>
        </div>
      </Card>

      <div className={styles.buttonGroup}>
        <Button
          className={styles.primaryButton}
          appearance="primary"
          icon={<Save24Regular />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "保存中..." : "保存设置"}
        </Button>
        <Button
          className={styles.secondaryButton}
          appearance="secondary"
          icon={<Delete24Regular />}
          onClick={handleReset}
        >
          重置
        </Button>
      </div>

      <div className={styles.infoCard}>
        <Text weight="semibold" style={{ marginBottom: "8px", display: "block" }}>使用说明</Text>
        <Text className={styles.infoText}>
          1. 选择您要使用的 AI 服务提供商
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
          4. 点击"保存设置"完成配置
        </Text>
      </div>
    </div>
  );
};

export default Settings;
