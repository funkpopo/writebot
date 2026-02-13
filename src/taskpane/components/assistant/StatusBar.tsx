import * as React from "react";
import { Text, mergeClasses } from "@fluentui/react-components";
import type { AgentPlanViewState } from "./useAssistantState";
import MarkdownView from "../MarkdownView";
import { useStyles } from "./styles";

export interface StatusBarProps {
  agentStatus: {
    state: "idle" | "running" | "success" | "error";
    message?: string;
  };
  applyStatus: {
    state: "success" | "warning" | "error";
    message: string;
  } | null;
  agentPlanView: AgentPlanViewState | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  agentStatus,
  applyStatus,
  agentPlanView,
}) => {
  const styles = useStyles();

  const hasStatus = agentStatus.state !== "idle";
  const hasPanel = Boolean(agentPlanView) || hasStatus || Boolean(applyStatus);
  if (!hasPanel) return null;

  return (
    <div className={styles.planPanel}>
      <div className={styles.planPanelHeader}>
        <Text className={styles.planPanelTitle}>执行计划（plan.md）</Text>
        {agentPlanView && (
          <Text className={styles.planPanelMeta}>
            当前阶段：{agentPlanView.currentStage}/{agentPlanView.totalStages}
          </Text>
        )}
      </div>

      {agentPlanView && (
        <>
          <Text className={styles.planPanelPath}>{agentPlanView.path}</Text>
          <div className={styles.planPanelContent}>
            <MarkdownView
              content={agentPlanView.content}
              className={mergeClasses(styles.markdownContent, styles.planMarkdownContent)}
            />
          </div>
        </>
      )}

      {hasStatus && (
        <Text
          className={mergeClasses(
            styles.planPanelStatus,
            agentStatus.state === "success" && styles.statusSuccess,
            agentStatus.state === "error" && styles.statusError
          )}
        >
          {agentStatus.state === "running" && "\u23F3"}
          {agentStatus.state === "success" && "\u2713"}
          {agentStatus.state === "error" && "\u2717"} 执行状态：
          {agentStatus.message || (agentStatus.state === "running" ? "处理中..." : "已完成")}
        </Text>
      )}

      {applyStatus && (
        <Text
          className={mergeClasses(
            styles.planPanelStatus,
            applyStatus.state === "success" && styles.statusSuccess,
            applyStatus.state === "warning" && styles.statusWarning,
            applyStatus.state === "error" && styles.statusError
          )}
        >
          {applyStatus.state === "success" && "\u2713"}
          {applyStatus.state === "warning" && "\u26A0"}
          {applyStatus.state === "error" && "\u2717"} 应用状态：{applyStatus.message}
        </Text>
      )}
    </div>
  );
};
