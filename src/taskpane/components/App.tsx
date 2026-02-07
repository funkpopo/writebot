import * as React from "react";
import { useState, useEffect } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Tooltip,
  Text,
} from "@fluentui/react-components";
import {
  Sparkle24Filled,
  Settings24Regular,
  TextDescription24Regular,
  ChevronLeft24Regular,
  TextAlignLeft24Regular,
} from "@fluentui/react-icons";
import AIWritingAssistant from "./AIWritingAssistant";
import TextAnalyzer from "./TextAnalyzer";
import Settings from "./Settings";
import FormatPanel from "./FormatPanel";
import { loadSettings } from "../../utils/storageService";
import { setAIConfig } from "../../utils/aiService";
import packageJson from "../../../package.json";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: "hidden",
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
  versionText: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    padding: "16px",
  },
  iconButton: {
    minWidth: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "8px",
  },
});

type TabValue = "assistant" | "analyzer" | "format" | "settings";

const App: React.FC = () => {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<TabValue>("assistant");
  const versionText = packageJson?.version ? `v${packageJson.version}` : "v0.0.0";

  // 初始化时加载保存的设置
  useEffect(() => {
    loadSettings().then((settings) => {
      setAIConfig(settings);
    });
  }, []);

  const renderContent = () => {
    switch (selectedTab) {
      case "assistant":
        return <AIWritingAssistant />;
      case "analyzer":
        return <TextAnalyzer />;
      case "format":
        return <FormatPanel />;
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
          <Sparkle24Filled primaryFill="#2B579A" />
          <Text className={styles.versionText}>{versionText}</Text>
        </div>
        <div className={styles.headerActions}>
          <Tooltip content="排版助手" relationship="label">
            <Button
              className={styles.iconButton}
              appearance={selectedTab === "format" ? "subtle" : "transparent"}
              icon={<TextAlignLeft24Regular />}
              onClick={() => setSelectedTab("format")}
            />
          </Tooltip>
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
            返回 主界面
          </Button>
        </div>
      )}
      <div className={styles.content}>{renderContent()}</div>
    </div>
  );
};

export default App;
