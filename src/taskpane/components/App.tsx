import * as React from "react";
import { useState, useEffect } from "react";
import {
  Tab,
  TabList,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
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
    padding: "12px",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tabList: {
    marginBottom: "16px",
  },
  content: {
    flex: 1,
    overflow: "auto",
  },
});

type TabValue = "assistant" | "analyzer" | "settings";

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
      <TabList
        className={styles.tabList}
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as TabValue)}
      >
        <Tab value="assistant">AI 写作助手</Tab>
        <Tab value="analyzer">文本分析</Tab>
        <Tab value="settings">设置</Tab>
      </TabList>
      <div className={styles.content}>{renderContent()}</div>
    </div>
  );
};

export default App;
