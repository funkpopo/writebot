import * as React from "react";
import { useState, useEffect } from "react";
import {
  Tab,
  TabList,
  makeStyles,
  tokens,
  Text,
  Button,
  Tooltip,
} from "@fluentui/react-components";
import {
  Sparkle24Filled,
  Settings24Regular,
  TextDescription24Regular,
  ChevronLeft24Regular,
} from "@fluentui/react-icons";
import AIWritingAssistant from "./AIWritingAssistant";
import TextAnalyzer from "./TextAnalyzer";
import Settings from "./Settings";
import { loadSettings } from "../../utils/storageService";
import { setAIConfig } from "../../utils/aiService";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  headerTitle: {
    fontSize: "16px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  tabList: {
    padding: "8px 16px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "16px",
  },
  iconButton: {
    minWidth: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "8px",
  },
});

type TabValue = "assistant" | "analyzer" | "settings";

const tabLabels: Record<TabValue, string> = {
  assistant: "AI 写作助手",
  analyzer: "文本分析",
  settings: "设置",
};

const App: React.FC = () => {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<TabValue>("assistant");

  // 初始化时加载保存的设置
  useEffect(() => {
    const settings = loadSettings();
    setAIConfig(settings);
  }, []);

  const renderContent = () => {
    switch (selectedTab) {
      case "assistant":
        return <AIWritingAssistant />;
      case "analyzer":
        return <TextAnalyzer />;
      case "settings":
        return <Settings />;
      default:
        return <AIWritingAssistant />;
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Sparkle24Filled primaryFill={tokens.colorBrandForeground1} />
          <Text className={styles.headerTitle}>{tabLabels[selectedTab]}</Text>
        </div>
        <div className={styles.headerActions}>
          <Tooltip content="文本分析" relationship="label">
            <Button
              className={styles.iconButton}
              appearance={selectedTab === "analyzer" ? "subtle" : "transparent"}
              icon={<TextDescription24Regular />}
              onClick={() => setSelectedTab("analyzer")}
            />
          </Tooltip>
          <Tooltip content="设置" relationship="label">
            <Button
              className={styles.iconButton}
              appearance={selectedTab === "settings" ? "subtle" : "transparent"}
              icon={<Settings24Regular />}
              onClick={() => setSelectedTab("settings")}
            />
          </Tooltip>
        </div>
      </div>
      {selectedTab !== "assistant" && (
        <div style={{ padding: "8px 16px" }}>
          <Button
            appearance="transparent"
            icon={<ChevronLeft24Regular />}
            onClick={() => setSelectedTab("assistant")}
            size="small"
          >
            返回 AI 助手
          </Button>
        </div>
      )}
      <div className={styles.content}>{renderContent()}</div>
    </div>
  );
};

export default App;
