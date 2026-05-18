import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Spinner,
  makeStyles,
  tokens,
  Text,
  Badge,
} from "@fluentui/react-components";
import {
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
import { throttle } from "../../utils/throttle";
import {
  BREAKPOINT_XS,
  PAGE_BOTTOM_SAFE_PADDING,
  SPACING,
  mediaMaxWidth,
} from "../ui/layoutConstants";
import { useDelayedBusyState } from "../hooks/useDelayedBusyState";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: SPACING.lg,
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    paddingBottom: PAGE_BOTTOM_SAFE_PADDING,
    scrollbarGutter: "stable both-edges",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "4px 0",
  },
  headerTitle: {
    fontSize: "16px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  headerSubtitle: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  buttonGroup: {
    display: "flex",
    flexDirection: "column",
    gap: SPACING.sm,
  },
  analyzeButton: {
    borderRadius: "6px",
    padding: "10px 12px",
    minHeight: "52px",
    justifyContent: "flex-start",
    backgroundColor: "transparent",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  buttonContent: {
    display: "flex",
    alignItems: "center",
    gap: SPACING.md,
    width: "100%",
    minWidth: 0,
  },
  buttonIcon: {
    fontSize: "20px",
    flexShrink: 0,
  },
  buttonText: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    minWidth: 0,
  },
  buttonLabel: {
    fontSize: "12px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  buttonDescription: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  statsPanel: {
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  statsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    userSelect: "none",
    gap: SPACING.sm,
    flexWrap: "wrap",
  },
  statsTable: {
    display: "grid",
    gridTemplateColumns: "minmax(88px, 1fr) minmax(72px, auto)",
  },
  statRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.md,
    padding: "10px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    gridColumn: "1 / -1",
    [mediaMaxWidth(BREAKPOINT_XS)]: {
      padding: "10px",
    },
  },
  statValue: {
    fontSize: "15px",
    fontWeight: "600",
    color: tokens.colorBrandForeground1,
    lineHeight: "1.2",
  },
  statLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    userSelect: "none",
  },
  emptyState: {
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: "14px 12px",
    display: "flex",
    alignItems: "center",
    gap: SPACING.sm,
    color: tokens.colorNeutralForeground3,
  },
  emptyStateIcon: {
    flexShrink: 0,
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
  const showSelectionSpinner = useDelayedBusyState(loading && analysisType === "selection");
  const showDocumentSpinner = useDelayedBusyState(loading && analysisType === "document");

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

  const throttledAutoAnalyzeRef = useRef(
    throttle(() => {
      void autoAnalyzeSelection();
    }, 300)
  );

  // Keep the throttled function in sync when autoAnalyzeSelection changes
  useEffect(() => {
    throttledAutoAnalyzeRef.current.cancel();
    throttledAutoAnalyzeRef.current = throttle(() => {
      void autoAnalyzeSelection();
    }, 300);
  }, [autoAnalyzeSelection]);

  // 组件加载时自动分析，并监听选择变化事件
  useEffect(() => {
    autoAnalyzeSelection();

    const handler = () => {
      throttledAutoAnalyzeRef.current();
    };

    addSelectionChangedHandler(handler).catch((error) => {
      console.error("添加选择变化监听器失败:", error);
    });

    return () => {
      throttledAutoAnalyzeRef.current.cancel();
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
          <span className={styles.buttonContent}>
            {showSelectionSpinner ? (
              <Spinner size="small" />
            ) : (
              <TextDescription24Regular className={styles.buttonIcon} />
            )}
            <span className={styles.buttonText}>
              <span className={styles.buttonLabel}>分析选中文本</span>
              <span className={styles.buttonDescription}>适合快速检查当前段落或片段。</span>
            </span>
          </span>
        </Button>
        <Button
          className={styles.analyzeButton}
          appearance="subtle"
          onClick={handleAnalyzeDocument}
          disabled={loading}
        >
          <span className={styles.buttonContent}>
            {showDocumentSpinner ? (
              <Spinner size="small" />
            ) : (
              <Document24Regular className={styles.buttonIcon} />
            )}
            <span className={styles.buttonText}>
              <span className={styles.buttonLabel}>分析全文</span>
              <span className={styles.buttonDescription}>统计整篇文档的字符、词句和段落。</span>
            </span>
          </span>
        </Button>
      </div>

      {stats && (
        <div className={styles.statsPanel}>
          <div className={styles.statsHeader}>
            <Text weight="semibold">
              {analysisType === "selection" ? "选中文本统计" : "全文统计"}
            </Text>
            <Badge appearance="filled" color="brand">已分析</Badge>
          </div>
          <div className={styles.statsTable}>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>总字符数</span>
              <span className={styles.statValue}>{stats.charCount}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>不含空格</span>
              <span className={styles.statValue}>{stats.charCountNoSpace}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>词数</span>
              <span className={styles.statValue}>{stats.wordCount}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>句子数</span>
              <span className={styles.statValue}>{stats.sentenceCount}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>段落数</span>
              <span className={styles.statValue}>{stats.paragraphCount}</span>
            </div>
          </div>
        </div>
      )}

      {!stats && !loading && (
        <div className={styles.emptyState}>
          <TextDescription24Regular className={styles.emptyStateIcon} />
          <Text size={200}>先选中文本，或直接运行全文分析。</Text>
        </div>
      )}
    </div>
  );
};

export default TextAnalyzer;
