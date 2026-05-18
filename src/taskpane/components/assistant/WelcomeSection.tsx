import * as React from "react";
import { Button, Text } from "@fluentui/react-components";
import type { AssistantModuleDefinition } from "../../../utils/assistantModuleService";
import { getAssistantModuleIcon } from "../../../utils/actionIcons";
import type { ActionType } from "./types";
import { useStyles } from "./styles";

export interface WelcomeSectionProps {
  modules: AssistantModuleDefinition[];
  handleQuickAction: (action: ActionType) => void;
}

export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
  modules,
  handleQuickAction,
}) => {
  const styles = useStyles();
  const visibleModules = modules.slice(0, 6);

  return (
    <div className={styles.welcomeSection}>
      <Text className={styles.welcomeTitle}>WriteBot 写作助手</Text>
      <Text className={styles.welcomeSubtitle}>
        先选中文本，或直接输入一句指令。
      </Text>
      <Text className={styles.welcomeHint}>常用命令</Text>
      <div className={styles.quickActions}>
        {visibleModules.map((module) => {
          const Icon = getAssistantModuleIcon(module);
          return (
            <Button
              key={module.id}
              className={styles.quickActionButton}
              appearance="subtle"
              icon={Icon ? <Icon /> : undefined}
              onClick={() => handleQuickAction(module.id)}
            >
              <span className={styles.quickActionContent}>
                <span className={styles.quickActionLabel}>{module.label}</span>
                <span className={styles.quickActionDescription}>
                  {module.description?.trim() || "使用当前内容直接处理"}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
      {modules.length === 0 && (
        <div className={styles.exampleList}>未启用功能模块。到设置页开启后，这里会显示常用命令。</div>
      )}
      <div className={styles.exampleList}>试试：润色选中文本、提炼要点、补一段总结。</div>
    </div>
  );
};
