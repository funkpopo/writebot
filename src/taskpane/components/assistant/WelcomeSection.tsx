import * as React from "react";
import { Button, Text } from "@fluentui/react-components";
import { ACTION_REGISTRY } from "../../../utils/actionRegistry";
import { ACTION_ICONS } from "../../../utils/actionIcons";
import type { ActionType } from "./types";
import { useStyles } from "./styles";

export interface WelcomeSectionProps {
  handleQuickAction: (action: ActionType) => void;
}

export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
  handleQuickAction,
}) => {
  const styles = useStyles();

  return (
    <div className={styles.welcomeSection}>
      <Text className={styles.welcomeTitle}>WriteBot 写作助手</Text>
      <Text className={styles.welcomeSubtitle}>
        选择文档中的文本，或直接描述需求开始
      </Text>
      <div className={styles.quickActions}>
        {ACTION_REGISTRY.map((action) => {
          const Icon = ACTION_ICONS[action.id];
          return (
            <Button
              key={action.id}
              className={styles.quickActionButton}
              appearance="subtle"
              icon={Icon ? <Icon /> : undefined}
              onClick={() => handleQuickAction(action.id)}
            >
              {action.label}
            </Button>
          );
        })}
      </div>
      <div className={styles.exampleList}>
        例如：
        <br />
        - 帮我润色选中的文本
        <br />
        - 找出文档中所有包含{"\u201C"}销售{"\u201D"}的段落
        <br />
        - 在文档末尾添加一段总结
      </div>
    </div>
  );
};
