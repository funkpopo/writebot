import * as React from "react";
import { Button, Text } from "@fluentui/react-components";
import {
  Sparkle24Regular,
  TextEditStyle24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
} from "@fluentui/react-icons";
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
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<Sparkle24Regular />}
          onClick={() => handleQuickAction("agent")}
        >
          智能需求
        </Button>
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<TextEditStyle24Regular />}
          onClick={() => handleQuickAction("polish")}
        >
          润色文本
        </Button>
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<Translate24Regular />}
          onClick={() => handleQuickAction("translate")}
        >
          翻译
        </Button>
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<TextGrammarCheckmark24Regular />}
          onClick={() => handleQuickAction("grammar")}
        >
          语法检查
        </Button>
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<TextBulletListSquare24Regular />}
          onClick={() => handleQuickAction("summarize")}
        >
          摘要
        </Button>
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<TextExpand24Regular />}
          onClick={() => handleQuickAction("continue")}
        >
          续写
        </Button>
        <Button
          className={styles.quickActionButton}
          appearance="subtle"
          icon={<Wand24Regular />}
          onClick={() => handleQuickAction("generate")}
        >
          生成
        </Button>
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