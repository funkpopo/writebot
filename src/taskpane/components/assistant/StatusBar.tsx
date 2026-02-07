import * as React from "react";
import { Text, mergeClasses } from "@fluentui/react-components";
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
}

export const StatusBar: React.FC<StatusBarProps> = ({
  agentStatus,
  applyStatus,
}) => {
  const styles = useStyles();

  return (
    <>
      {agentStatus.state !== "idle" && (
        <div className={styles.statusBar}>
          <Text
            className={mergeClasses(
              agentStatus.state === "success" && styles.statusSuccess,
              agentStatus.state === "error" && styles.statusError
            )}
          >
            {agentStatus.state === "running" && "\u23F3"}
            {agentStatus.state === "success" && "\u2713"}
            {agentStatus.state === "error" && "\u2717"} 智能需求状态：
            {agentStatus.message || (agentStatus.state === "running" ? "处理中..." : "已完成")}
          </Text>
        </div>
      )}

      {applyStatus && (
        <div className={styles.statusBar}>
          <Text
            className={mergeClasses(
              applyStatus.state === "success" && styles.statusSuccess,
              applyStatus.state === "warning" && styles.statusWarning,
              applyStatus.state === "error" && styles.statusError
            )}
          >
            {applyStatus.state === "success" && "\u2713"}
            {applyStatus.state === "warning" && "\u26A0"}
            {applyStatus.state === "error" && "\u2717"} 应用状态：{applyStatus.message}
          </Text>
        </div>
      )}
    </>
  );
};
