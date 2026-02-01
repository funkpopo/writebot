import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Spinner,
  makeStyles,
  tokens,
  Card,
  Text,
  Badge,
} from "@fluentui/react-components";
import {
  DocumentSearch24Regular,
  Document24Regular,
  TextDescription24Regular,
} from "@fluentui/react-icons";
import {
  getSelectedText,
  getDocumentText,
  getParagraphCountInSelection,
  getParagraphCountInDocument,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
} from "../../utils/wordApi";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    textAlign: "center",
    padding: "16px 0",
  },
  headerTitle: {
    fontSize: "20px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    marginBottom: "4px",
  },
  headerSubtitle: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  buttonGroup: {
    display: "flex",
    gap: "12px",
  },
  analyzeButton: {
    flex: 1,
    borderRadius: "12px",
    padding: "12px 16px",
    height: "auto",
    flexDirection: "column",
    gap: "8px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: "none",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  buttonIcon: {
    fontSize: "24px",
    marginBottom: "4px",
  },
  buttonLabel: {
    fontSize: "13px",
    fontWeight: "500",
  },
  statsCard: {
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: tokens.shadow4,
  },
  statsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1px",
    backgroundColor: tokens.colorNeutralStroke2,
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 12px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  statValue: {
    fontSize: "28px",
    fontWeight: "600",
    color: "#2B579A",
    lineHeight: "1",
  },
  statLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "8px",
  },
  fullWidthStat: {
    gridColumn: "1 / -1",
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

  const analyzeText = (text: string, paragraphCountOverride?: number): TextStats => {
    const charCount = text.length;
    const charCountNoSpace = text.replace(/\s/g, "").length;
    const englishWords = text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || [];
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    const wordCount = englishWords.length + chineseChars.length;
    const sentences = text.split(/[.!?。！？]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const paragraphs = text.split(/\r\n|\r|\n/).filter((p) => p.trim().length > 0);
    const paragraphCount = paragraphCountOverride ?? Math.max(paragraphs.length, text.trim() ? 1 : 0);

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
      const [text, paragraphCount] = await Promise.all([
        getSelectedText(),
        getParagraphCountInSelection(),
      ]);
      if (text.trim()) {
        setStats(analyzeText(text, paragraphCount));
        setAnalysisType("selection");
      } else {
        setStats(null);
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
      const [text, paragraphCount] = await Promise.all([
        getSelectedText(),
        getParagraphCountInSelection(),
      ]);
      if (text.trim()) {
        setStats(analyzeText(text, paragraphCount));
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
      const [text, paragraphCount] = await Promise.all([
        getDocumentText(),
        getParagraphCountInDocument(),
      ]);
      if (text.trim()) {
        setStats(analyzeText(text, paragraphCount));
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
      <div className={styles.header}>
        <Text className={styles.headerTitle}>文本分析</Text>
        <Text className={styles.headerSubtitle}>统计文档或选中文本的字数信息</Text>
      </div>

      <div className={styles.buttonGroup}>
        <Button
          className={styles.analyzeButton}
          appearance="subtle"
          onClick={handleAnalyzeSelection}
          disabled={loading}
        >
          {loading && analysisType === "selection" ? (
            <Spinner size="small" />
          ) : (
            <TextDescription24Regular className={styles.buttonIcon} />
          )}
          <span className={styles.buttonLabel}>分析选中文本</span>
        </Button>
        <Button
          className={styles.analyzeButton}
          appearance="subtle"
          onClick={handleAnalyzeDocument}
          disabled={loading}
        >
          {loading && analysisType === "document" ? (
            <Spinner size="small" />
          ) : (
            <Document24Regular className={styles.buttonIcon} />
          )}
          <span className={styles.buttonLabel}>分析全文</span>
        </Button>
      </div>

      {stats && (
        <Card className={styles.statsCard}>
          <div className={styles.statsHeader}>
            <Text weight="semibold">
              {analysisType === "selection" ? "选中文本统计" : "全文统计"}
            </Text>
            <Badge appearance="filled" color="brand">已分析</Badge>
          </div>
          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.charCount}</span>
              <span className={styles.statLabel}>总字符数</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.charCountNoSpace}</span>
              <span className={styles.statLabel}>不含空格</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.wordCount}</span>
              <span className={styles.statLabel}>词数</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.sentenceCount}</span>
              <span className={styles.statLabel}>句子数</span>
            </div>
            <div className={`${styles.statItem} ${styles.fullWidthStat}`}>
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
