import * as React from "react";
import { Button, Text, mergeClasses } from "@fluentui/react-components";
import { ChevronDown24Regular, ChevronUp24Regular } from "@fluentui/react-icons";
import type { AgentPlanViewState } from "./useAssistantState";
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

interface StageItem {
  index: number;
  text: string;
}

function extractStageItems(markdown: string, totalStages: number): StageItem[] {
  const lines = markdown.split(/\r?\n/g);
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##+\s*阶段计划\s*$/i.test(line)) {
      start = i + 1;
      break;
    }
  }

  if (start >= 0) {
    for (let i = start; i < lines.length; i++) {
      if (/^##+\s+/.test(lines[i].trim())) {
        end = i;
        break;
      }
    }
  } else {
    start = 0;
  }

  const targetLines = lines.slice(start, end);
  const parsedItems: StageItem[] = [];

  for (const rawLine of targetLines) {
    const line = rawLine.trim();
    const orderedMatch = line.match(/^(\d+)\.\s*(?:\[[ xX]\]\s*)?(.*)$/);
    if (orderedMatch && orderedMatch[2].trim()) {
      parsedItems.push({
        index: Math.max(1, Number(orderedMatch[1])),
        text: orderedMatch[2].trim(),
      });
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s*(?:\[[ xX]\]\s*)?(.*)$/);
    if (bulletMatch && bulletMatch[1].trim()) {
      parsedItems.push({
        index: parsedItems.length + 1,
        text: bulletMatch[1].trim(),
      });
    }
  }

  if (parsedItems.length > 0) return parsedItems;

  return Array.from({ length: Math.max(1, totalStages) }).map((_, idx) => ({
    index: idx + 1,
    text: `阶段 ${idx + 1}`,
  }));
}

export const StatusBar: React.FC<StatusBarProps> = ({
  agentStatus,
  applyStatus,
  agentPlanView,
}) => {
  const styles = useStyles();
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setExpanded(false);
  }, [agentPlanView?.updatedAt]);

  const hasStatus = agentStatus.state !== "idle";
  const hasPanel = Boolean(agentPlanView) || hasStatus || Boolean(applyStatus);
  if (!hasPanel) return null;

  const stageItems = agentPlanView
    ? extractStageItems(agentPlanView.content, agentPlanView.totalStages)
    : [];
  const completedStages = new Set(agentPlanView?.completedStages ?? []);

  return (
    <div className={styles.planPanel}>
      <div className={styles.planPanelHeader}>
        <div className={styles.planPanelHeaderLeft}>
          <Text className={styles.planPanelTitle}>阶段计划</Text>
          {agentPlanView && (
            <Text className={styles.planPanelMeta}>
              当前阶段：{agentPlanView.currentStage}/{agentPlanView.totalStages}
            </Text>
          )}
        </div>
        {agentPlanView && (
          <Button
            appearance="subtle"
            className={styles.planPanelToggle}
            icon={expanded ? <ChevronUp24Regular /> : <ChevronDown24Regular />}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "收起" : "展开"}
          </Button>
        )}
      </div>

      {agentPlanView && expanded && (
        <div className={styles.planPanelContent}>
          {stageItems.map((item) => {
            const done = completedStages.has(item.index) || agentPlanView.currentStage > item.index;
            return (
              <div
                key={`${item.index}_${item.text}`}
                className={mergeClasses(
                  styles.planStageItem,
                  done && styles.planStageItemDone
                )}
              >
                <Text className={styles.planStageCheck}>{done ? "☑" : "☐"}</Text>
                <Text className={styles.planStageText}>
                  {item.index}. {item.text}
                </Text>
              </div>
            );
          })}
        </div>
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
