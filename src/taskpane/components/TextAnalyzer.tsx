import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Spinner,
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Badge,
} from "@fluentui/react-components";
import { DocumentSearch24Regular } from "@fluentui/react-icons";
import {
  getSelectedText,
  getDocumentText,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
} from "../../utils/wordApi";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  buttonGroup: {
    display: "flex",
    gap: "8px",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    padding: "12px",
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "8px",
  },
  statValue: {
    fontSize: "24px",
    fontWeight: "600",
    color: tokens.colorBrandForeground1,
  },
  statLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
});

interface TextStats {
  charCount: number;
  charCountNoSpace: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
}

const TextAnalyzer: React.FC = () => {
  const styles = useStyles();
  const [stats, setStats] = useState<TextStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysisType, setAnalysisType] = useState<"selection" | "document">("selection");

  const analyzeText = (text: string): TextStats => {
    const charCount = text.length;
    const charCountNoSpace = text.replace(/\s/g, "").length;
    const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;
    const sentences = text.split(/[.!?。！？]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const paragraphCount = Math.max(paragraphs.length, text.trim() ? 1 : 0);

    return {
      charCount,
      charCountNoSpace,
      wordCount,
      sentenceCount,
      paragraphCount,
    };
  };

  // 自动分析选中文本
  const autoAnalyzeSelection = useCallback(async () => {
    try {
      const text = await getSelectedText();
      if (text.trim()) {
        setStats(analyzeText(text));
        setAnalysisType("selection");
      }
    } catch (error) {
      console.error("自动分析选中文本失败:", error);
    }
  }, []);

  // 组件加载时自动分析，并监听选择变化事件
  useEffect(() => {
    autoAnalyzeSelection();

    const handler = () => {
      autoAnalyzeSelection();
    };

    addSelectionChangedHandler(handler).catch((error) => {
      console.error("添加选择变化监听器失败:", error);
    });

    return () => {
      removeSelectionChangedHandler(handler).catch((error) => {
        console.error("移除选择变化监听器失败:", error);
      });
    };
  }, [autoAnalyzeSelection]);

  const handleAnalyzeSelection = async () => {
    setLoading(true);
    setAnalysisType("selection");
    try {
      const text = await getSelectedText();
      if (text.trim()) {
        setStats(analyzeText(text));
      } else {
        setStats(null);
      }
    } catch (error) {
      console.error("分析选中文本失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeDocument = async () => {
    setLoading(true);
    setAnalysisType("document");
    try {
      const text = await getDocumentText();
      if (text.trim()) {
        setStats(analyzeText(text));
      } else {
        setStats(null);
      }
    } catch (error) {
      console.error("分析文档失败:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.buttonGroup}>
        <Button
          icon={loading ? <Spinner size="tiny" /> : <DocumentSearch24Regular />}
          onClick={handleAnalyzeSelection}
          disabled={loading}
        >
          分析选中文本
        </Button>
        <Button
          icon={loading ? <Spinner size="tiny" /> : <DocumentSearch24Regular />}
          onClick={handleAnalyzeDocument}
          disabled={loading}
        >
          分析全文
        </Button>
      </div>

      {stats && (
        <Card>
          <CardHeader
            header={
              <Text weight="semibold">
                {analysisType === "selection" ? "选中文本统计" : "全文统计"}
              </Text>
            }
            action={<Badge appearance="filled">已分析</Badge>}
          />
          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.charCount}</span>
              <span className={styles.statLabel}>总字符数</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.charCountNoSpace}</span>
              <span className={styles.statLabel}>字符数(不含空格)</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.wordCount}</span>
              <span className={styles.statLabel}>词数</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.sentenceCount}</span>
              <span className={styles.statLabel}>句子数</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.paragraphCount}</span>
              <span className={styles.statLabel}>段落数</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default TextAnalyzer;