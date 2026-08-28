import * as React from "react";
import { Button, Card, Text, mergeClasses } from "@fluentui/react-components";
import { ArrowSync24Regular } from "@fluentui/react-icons";
import type { AIProfile } from "../../../utils/storageService";
import type { RuntimeDiagnostics } from "../../../utils/settingsDiagnostics";
import { DEFAULT_PARALLEL_SECTIONS, getApiTypeLabel, formatDateTime, type OfficeHostSummary } from "./settingsShared";
import { useStyles } from "./settingsStyles";

export interface DiagnosticsCardProps {
  runtimeDiagnostics: RuntimeDiagnostics | null;
  diagnosticsLoading: boolean;
  diagnosticsError: string | null;
  diagnosticsExpanded: boolean;
  setDiagnosticsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  refreshRuntimeDiagnostics: () => Promise<void>;
  officeHostSummary: OfficeHostSummary;
  activeProfile: AIProfile | undefined;
}

export function DiagnosticsCard({
  runtimeDiagnostics,
  diagnosticsLoading,
  diagnosticsError,
  diagnosticsExpanded,
  setDiagnosticsExpanded,
  refreshRuntimeDiagnostics,
  officeHostSummary,
  activeProfile,
}: DiagnosticsCardProps) {
  const styles = useStyles();
  return (
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
  );
}
