import * as React from "react";
import { Suspense, lazy, useState, useEffect } from "react";
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
import { loadSettings } from "../../utils/storageService";
import packageJson from "../../../package.json";
import { PAGE_PADDING_X, PAGE_PADDING_Y, SPACING } from "../ui/layoutConstants";

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
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    userSelect: "none",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: SPACING.md,
    userSelect: "none",
  },
  versionText: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    userSelect: "none",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: SPACING.xs,
    userSelect: "none",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    padding: `${PAGE_PADDING_Y} ${PAGE_PADDING_X}`,
  },
  backRow: {
    padding: `4px ${PAGE_PADDING_X}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tabContent: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  iconButton: {
    minWidth: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "8px",
    userSelect: "none",
  },
  loadingPane: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.colorNeutralForeground3,
  },
});

type TabValue = "assistant" | "analyzer" | "format" | "settings";

const AIWritingAssistant = lazy(() => import("./AIWritingAssistant"));
const TextAnalyzer = lazy(() => import("./TextAnalyzer"));
const Settings = lazy(() => import("./Settings"));
const FormatPanel = lazy(() => import("./FormatPanel"));

const App: React.FC = () => {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<TabValue>("assistant");
  const versionText = packageJson?.version ? `v${packageJson.version}` : "v0.0.0";

  // 初始化时加载保存的设置
  useEffect(() => {
    loadSettings().then((settings) => {
      void import("../../utils/aiService").then(({ setAIConfig }) => {
        setAIConfig(settings);
      });
    });
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        switch (e.key) {
          case "1":
            e.preventDefault();
            setSelectedTab("assistant");
            break;
          case "2":
            e.preventDefault();
            setSelectedTab("analyzer");
            break;
          case "3":
            e.preventDefault();
            setSelectedTab("format");
            break;
          case ",":
            e.preventDefault();
            setSelectedTab("settings");
            break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
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
          <Sparkle24Filled primaryFill={tokens.colorBrandForeground1} />
          <Text className={styles.versionText}>{versionText}</Text>
        </div>
        <div className={styles.headerActions}>
          <Tooltip content="打开排版助手" relationship="label">
            <Button
              className={styles.iconButton}
              appearance={selectedTab === "format" ? "subtle" : "transparent"}
              icon={<TextAlignLeft24Regular />}
              onClick={() => setSelectedTab("format")}
            />
          </Tooltip>
          <Tooltip content="打开文本分析" relationship="label">
            <Button
              className={styles.iconButton}
              appearance={selectedTab === "analyzer" ? "subtle" : "transparent"}
              icon={<TextDescription24Regular />}
              onClick={() => setSelectedTab("analyzer")}
            />
          </Tooltip>
          <Tooltip content="打开设置" relationship="label">
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
        <div className={styles.backRow}>
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
      <div className={styles.content}>
        <div className={styles.tabContent}>
          <Suspense fallback={<div className={styles.loadingPane}>正在加载...</div>}>
            {renderContent()}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default App;
