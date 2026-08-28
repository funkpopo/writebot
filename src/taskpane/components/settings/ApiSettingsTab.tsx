import * as React from "react";
import {
  Button,
  Input,
  Card,
  Text,
  Spinner,
  Dropdown,
  Option,
  Field,
  Switch,
  mergeClasses,
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
  AIProfile,
  APIType,
  getAISettingsValidationError,
  SystemProxyProtocol,
  SystemProxySettings,
} from "../../../utils/storageService";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../../utils/tokenUtils";
import type {
  ConnectionTestResult,
  ModelProbeResult,
  RuntimeDiagnostics,
} from "../../../utils/settingsDiagnostics";
import { useStyles } from "./settingsStyles";
import {
  apiTypeOptions,
  endpointExamples,
  modelExamples,
  DEFAULT_HTTP_PROXY_PORT,
  DEFAULT_SOCKS5_PROXY_PORT,
  DEFAULT_PARALLEL_SECTIONS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  systemProxyTypeOptions,
  getProfileDisplayName,
  getApiTypeLabel,
  getProbeValidationError,
  parseOptionalFloat,
  parseOptionalInt,
  type OfficeHostSummary,
} from "./settingsShared";
import { DiagnosticsCard } from "./DiagnosticsCard";

export interface ApiSettingsTabProps {
  profiles: AIProfile[];
  activeProfileId: string;
  activeProfile: AIProfile | undefined;
  expandedProfileId: string | null;
  showApiKeyFor: string | null;
  savingId: string | null;
  testingProfileId: string | null;
  probingProfileId: string | null;
  connectionResults: Record<string, ConnectionTestResult>;
  modelProbeResults: Record<string, ModelProbeResult>;
  systemProxy: SystemProxySettings;
  showProxyPassword: boolean;
  proxySaving: boolean;
  setSystemProxy: React.Dispatch<React.SetStateAction<SystemProxySettings>>;
  setShowProxyPassword: React.Dispatch<React.SetStateAction<boolean>>;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  diagnosticsLoading: boolean;
  diagnosticsError: string | null;
  diagnosticsExpanded: boolean;
  setDiagnosticsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  refreshRuntimeDiagnostics: () => Promise<void>;
  systemProxyValidationError: string | null;
  officeHostSummary: OfficeHostSummary;
  handleAddProfile: () => void;
  handleSaveSystemProxy: () => void;
  handleSystemProxyProtocolChange: (protocol: SystemProxyProtocol) => void;
  handleSystemProxyPortChange: (rawValue: string) => void;
  handleSystemProxyFieldChange: (field: "host" | "username" | "password", value: string) => void;
  handleSetActive: (profileId: string) => Promise<void>;
  toggleExpand: (profileId: string) => void;
  handleDeleteProfile: (profileId: string) => Promise<void>;
  handleApiTypeChange: (profileId: string, newType: APIType) => void;
  handleMaxOutputTokensChange: (profileId: string, rawValue: string) => void;
  handleProfileNumberChange: (profileId: string, field: keyof AIProfile, rawValue: string, parser: (value: string) => number | undefined) => void;
  handleProfileChange: (profileId: string, field: keyof AIProfile, value: string) => void;
  handleModelProbe: (profileId: string) => Promise<void>;
  handleConnectionTest: (profileId: string) => Promise<void>;
  setShowApiKeyFor: React.Dispatch<React.SetStateAction<string | null>>;
  handleSaveProfile: (profileId: string) => Promise<void>;
}

export function ApiSettingsTab({
  profiles,
  activeProfileId,
  activeProfile,
  expandedProfileId,
  showApiKeyFor,
  savingId,
  testingProfileId,
  probingProfileId,
  connectionResults,
  modelProbeResults,
  systemProxy,
  showProxyPassword,
  proxySaving,
  setSystemProxy,
  setShowProxyPassword,
  runtimeDiagnostics,
  diagnosticsLoading,
  diagnosticsError,
  diagnosticsExpanded,
  setDiagnosticsExpanded,
  refreshRuntimeDiagnostics,
  systemProxyValidationError,
  officeHostSummary,
  handleAddProfile,
  handleSaveSystemProxy,
  handleSystemProxyProtocolChange,
  handleSystemProxyPortChange,
  handleSystemProxyFieldChange,
  handleSetActive,
  toggleExpand,
  handleDeleteProfile,
  handleApiTypeChange,
  handleMaxOutputTokensChange,
  handleProfileNumberChange,
  handleProfileChange,
  handleModelProbe,
  handleConnectionTest,
  setShowApiKeyFor,
  handleSaveProfile,
}: ApiSettingsTabProps) {
  const styles = useStyles();
  return (
          <>
            <div className={styles.actionRow}>
              <Text className={styles.activeHint}>当前：{getProfileDisplayName(activeProfile)}</Text>
              <div className={styles.actionButtons}>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleAddProfile}>
                  添加配置
                </Button>
              </div>
            </div>

            <DiagnosticsCard
              runtimeDiagnostics={runtimeDiagnostics}
              diagnosticsLoading={diagnosticsLoading}
              diagnosticsError={diagnosticsError}
              diagnosticsExpanded={diagnosticsExpanded}
              setDiagnosticsExpanded={setDiagnosticsExpanded}
              refreshRuntimeDiagnostics={refreshRuntimeDiagnostics}
              officeHostSummary={officeHostSummary}
              activeProfile={activeProfile}
            />

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
  );
}
