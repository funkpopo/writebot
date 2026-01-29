import * as React from "react";
import { useState, useEffect } from "react";
import {
  Button,
  Input,
  makeStyles,
  tokens,
  Card,
  CardHeader,
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
    gap: "16px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  inputWrapper: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  input: {
    flex: 1,
  },
  buttonGroup: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
  hint: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  modelDropdown: {
    minWidth: "200px",
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
      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}

      <Card>
        <CardHeader header={<Text weight="semibold">AI API 配置</Text>} />
        <div className={styles.container} style={{ padding: "12px" }}>
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
          appearance="primary"
          icon={<Save24Regular />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "保存中..." : "保存设置"}
        </Button>
        <Button
          appearance="secondary"
          icon={<Delete24Regular />}
          onClick={handleReset}
        >
          重置为默认
        </Button>
      </div>

      <Card>
        <CardHeader header={<Text weight="semibold">使用说明</Text>} />
        <div style={{ padding: "12px" }}>
          <Text>
            1. 选择您要使用的 AI 服务提供商
            <br />
            2. 前往对应官网获取 API 密钥：
            <br />
            &nbsp;&nbsp;• OpenAI: platform.openai.com
            <br />
            &nbsp;&nbsp;• Anthropic: console.anthropic.com
            <br />
            &nbsp;&nbsp;• Google: aistudio.google.com
            <br />
            3. 填入 API 密钥、端点地址和模型名称
            <br />
            4. 点击"保存设置"完成配置
            <br />
            <br />
            <Text weight="semibold">注意：</Text>您的 API 密钥仅保存在本地，不会上传到任何服务器。
          </Text>
        </div>
      </Card>
    </div>
  );
};

export default Settings;
