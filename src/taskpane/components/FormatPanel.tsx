import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Text,
  ProgressBar,
  makeStyles,
  tokens,
  Badge,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Checkbox,
  RadioGroup,
  Radio,
  Input,
  Field,
  Switch,
  Combobox,
  Option,
} from "@fluentui/react-components";
import {
  Warning20Regular,
  Info20Regular,
  TextAlignLeft24Regular,
  ArrowUndo24Regular,
  Play24Regular,
  Stop24Regular,
  Search24Regular,
  Checkmark20Regular,
} from "@fluentui/react-icons";
import {
  analyzeFormatSession,
  applyChangePlan,
  undoLastOptimization,
  getOperationLogs,
  addOperationLog,
  resolveScopeParagraphIndices,
  applyHeaderFooterTemplate,
  applyTypographyNormalization,
} from "../../utils/formatService";
import type {
  ChangeType,
  ChangeItem,
  FormatAnalysisSession,
  FormatScopeType,
  HeaderFooterTemplate,
  TypographyOptions,
  CancelToken,
} from "../../utils/formatService";
import {
  selectParagraphByIndex,
  highlightParagraphs,
  clearParagraphHighlights,
  getAvailableFonts,
} from "../../utils/wordApi";
import type { FormatSpecification } from "../../utils/wordApi";

const useStyles = makeStyles({
  container: {
    height: "100%",
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
  },
  scrollContent: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingBottom: "16px",
  },
  card: {
    padding: "12px",
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  progressSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "8px",
  },
  resultSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "8px",
  },
  listItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "4px 0",
  },
  listIcon: {
    width: "20px",
    height: "20px",
    flexShrink: 0,
  },
  formatPreview: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    fontFamily: "monospace",
    whiteSpace: "pre-wrap",
    maxHeight: "150px",
    overflow: "auto",
    padding: "8px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
  },
  statsRow: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
  },
  statItem: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  scopeRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  indicesInput: {
    minWidth: "140px",
    flex: 1,
  },
  issueMeta: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  changeItem: {
    padding: "8px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  changeItemHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  changeItemBody: {
    marginTop: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  inlineRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  compactField: {
    flex: 1,
    minWidth: "100px",
  },
  fieldRow: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
  },
  sectionTitle: {
    marginBottom: "4px",
  },
  actionButtons: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
    paddingTop: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  successMessage: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    color: tokens.colorPaletteGreenForeground1,
    fontSize: "12px",
  },
  cancelButton: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": {
      backgroundColor: tokens.colorPaletteRedForeground1,
    },
  },
});

interface ProgressState {
  current: number;
  total: number;
  message: string;
}

const scopeOptions: { value: FormatScopeType; label: string }[] = [
  { value: "selection", label: "选区" },
  { value: "currentSection", label: "当前节" },
  { value: "document", label: "全文" },
  { value: "headings", label: "仅标题" },
  { value: "bodyText", label: "仅正文" },
  { value: "paragraphs", label: "指定段落" },
];

const defaultHeaderTemplate: HeaderFooterTemplate = {
  primaryHeader: "{documentName}",
  primaryFooter: "第 {pageNumber} 页",
  useDifferentFirstPage: false,
  useDifferentOddEven: false,
  includePageNumber: true,
  includeDate: false,
  includeDocumentName: true,
};

const defaultTypography: TypographyOptions = {
  chineseFont: "宋体",
  englishFont: "Times New Roman",
  enforceSpacing: true,
  enforcePunctuation: true,
  applyFontMapping: false,
  fontApplicationMode: "defaultText",
  skipSensitiveContent: true,
};

const bodyLineSpacingPresets = ["1.0", "1.25", "1.5", "2.0"];
const customBodyLineSpacingOption = "__custom__";
const highImpactGlobalChangeTypes: Set<ChangeType> = new Set([
  "header-footer-template",
  "table-style",
  "image-alignment",
]);

const issueDrivenChangeTypeMap: Partial<Record<ChangeType, string[]>> = {
  "heading-level-fix": ["hierarchy"],
  "heading-style": ["heading-consistency"],
  "body-style": ["body-consistency"],
  "list-style": ["list-consistency"],
  "color-correction": ["color-highlight"],
  "mixed-typography": ["mixed-typography"],
  "punctuation-spacing": ["punctuation-spacing"],
  "special-content": ["special-content"],
  "underline-removal": ["underline"],
  "italic-removal": ["italic"],
  "strikethrough-removal": ["strikethrough"],
};

function isIssueDrivenLowRiskItem(item: ChangeItem, issueHits: Set<string>): boolean {
  if (item.requiresContentChange || highImpactGlobalChangeTypes.has(item.type)) {
    return false;
  }
  const linkedIssueIds = issueDrivenChangeTypeMap[item.type];
  if (!linkedIssueIds || linkedIssueIds.length === 0) {
    return false;
  }
  return linkedIssueIds.some((issueId) => issueHits.has(issueId));
}

function buildDefaultSelectedChangeIds(session: FormatAnalysisSession): string[] {
  const issueHits = new Set(
    session.issues.filter((category) => category.items.length > 0).map((category) => category.id)
  );
  return session.changePlan.items
    .filter((item) => isIssueDrivenLowRiskItem(item, issueHits))
    .map((item) => item.id);
}

const FormatPanel: React.FC = () => {
  const styles = useStyles();

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    current: 0,
    total: 0,
    message: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [analysisSession, setAnalysisSession] = useState<FormatAnalysisSession | null>(null);
  const [scopeType, setScopeType] = useState<FormatScopeType>("selection");
  const [indicesInput, setIndicesInput] = useState("");
  const [highlightedIndices, setHighlightedIndices] = useState<number[]>([]);
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([]);
  const [colorSelections, setColorSelections] = useState<number[]>([]);
  const [headerFooterTemplate, setHeaderFooterTemplate] = useState<HeaderFooterTemplate>(
    defaultHeaderTemplate
  );
  const [typographyOptions, setTypographyOptions] = useState<TypographyOptions>(
    defaultTypography
  );
  const [operationLogs, setOperationLogs] = useState(getOperationLogs());
  const cancelTokenRef = useRef<CancelToken>({ cancelled: false });
  const [headerFooterApplied, setHeaderFooterApplied] = useState(false);
  const [typographyApplied, setTypographyApplied] = useState(false);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [bodyLineSpacing, setBodyLineSpacing] = useState("1.5");
  const [bodyLineSpacingOption, setBodyLineSpacingOption] = useState("1.5");

  // 加载Word中可用的字体列表
  useEffect(() => {
    const loadFonts = async () => {
      try {
        const fonts = await getAvailableFonts();
        setAvailableFonts(fonts);
      } catch {
        // 使用默认字体列表
        setAvailableFonts([
          "宋体", "黑体", "楷体", "仿宋", "微软雅黑",
          "Times New Roman", "Arial", "Calibri",
        ]);
      }
    };
    loadFonts();
  }, []);

  useEffect(() => {
    if (analysisSession) {
      setSelectedChangeIds(buildDefaultSelectedChangeIds(analysisSession));
      const defaultColorSelections = analysisSession.colorAnalysis
        .filter((item) => !item.isReasonable)
        .map((item) => item.paragraphIndex);
      setColorSelections(defaultColorSelections);
      const spacing = analysisSession.formatSpec?.bodyText?.paragraph.lineSpacing;
      const fallbackPreset = bodyLineSpacingPresets[0] || "1.5";
      if (Number.isFinite(spacing) && (spacing || 0) > 0) {
        const rounded = Math.round((spacing as number) * 100) / 100;
        const matchedPreset = bodyLineSpacingPresets.find(
          (preset) => Number.parseFloat(preset) === rounded
        );
        if (matchedPreset) {
          setBodyLineSpacing(matchedPreset);
          setBodyLineSpacingOption(matchedPreset);
        } else {
          setBodyLineSpacing(String(rounded));
          setBodyLineSpacingOption(customBodyLineSpacingOption);
        }
      } else {
        setBodyLineSpacing(fallbackPreset);
        setBodyLineSpacingOption(fallbackPreset);
      }
    }
  }, [analysisSession]);

  const parseIndicesInput = (value: string): number[] => {
    if (!value.trim()) return [];
    const parts = value.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
    const indices: number[] = [];

    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (Number.isNaN(start) || Number.isNaN(end)) continue;
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        for (let i = min; i <= max; i++) {
          if (i > 0) indices.push(i - 1);
        }
      } else {
        const num = parseInt(part, 10);
        if (!Number.isNaN(num) && num > 0) {
          indices.push(num - 1);
        }
      }
    }

    return Array.from(new Set(indices)).sort((a, b) => a - b);
  };

  const buildScope = (): { type: FormatScopeType; paragraphIndices?: number[] } => {
    if (scopeType === "paragraphs") {
      return { type: "paragraphs", paragraphIndices: parseIndicesInput(indicesInput) };
    }
    return { type: scopeType };
  };

  const parseBodyLineSpacing = (): number | null => {
    const normalized = bodyLineSpacing.trim().replace(/[，,]/g, ".");
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("正文行间距必须是大于 0 的数字");
      return null;
    }
    return Math.round(parsed * 100) / 100;
  };

  const withCustomBodyLineSpacing = (
    session: FormatAnalysisSession,
    spacing: number
  ): FormatAnalysisSession => {
    const currentSpec = session.formatSpec;
    if (!currentSpec?.bodyText) return session;

    const lineSpacingRule: "multiple" | "exactly" = spacing > 6 ? "exactly" : "multiple";
    const updatedFormatSpec: FormatSpecification = {
      ...currentSpec,
      bodyText: {
        ...currentSpec.bodyText,
        paragraph: {
          ...currentSpec.bodyText.paragraph,
          lineSpacing: spacing,
          lineSpacingRule,
        },
      },
    };

    return {
      ...session,
      formatSpec: updatedFormatSpec,
      changePlan: {
        ...session.changePlan,
        formatSpec: updatedFormatSpec,
      },
    };
  };

  const handleAnalyze = async () => {
    setIsProcessing(true);
    setError(null);
    cancelTokenRef.current.cancelled = false;

    try {
      const session = await analyzeFormatSession(buildScope(), {
        onProgress: (current, total, message) => setProgress({ current, total, message }),
        cancelToken: cancelTokenRef.current,
      });
      setAnalysisSession(session);
      setOperationLogs(getOperationLogs());
    } catch (err) {
      if (err instanceof Error && err.message === "操作已取消") {
        setError("分析已取消");
      } else {
        setError(err instanceof Error ? err.message : "分析失败");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = async () => {
    if (!analysisSession) return;
    const hasBodyStyleSelected = analysisSession.changePlan.items.some(
      (item) => item.type === "body-style" && selectedChangeIds.includes(item.id)
    );
    let sessionToApply = analysisSession;
    if (hasBodyStyleSelected) {
      const customBodyLineSpacing = parseBodyLineSpacing();
      if (customBodyLineSpacing === null) {
        return;
      }
      sessionToApply = withCustomBodyLineSpacing(analysisSession, customBodyLineSpacing);
    }

    const selectedItems = sessionToApply.changePlan.items.filter((item) =>
      selectedChangeIds.includes(item.id)
    );
    const highImpactGlobalItems = selectedItems.filter((item) =>
      highImpactGlobalChangeTypes.has(item.type)
    );
    if (highImpactGlobalItems.length > 0) {
      const confirmGlobalApply = window.confirm(
        `所选项包含高影响的全局变更：${highImpactGlobalItems.map((item) => item.title).join("、")}。\n` +
        "这些操作会影响全文，请再次确认是否继续。"
      );
      if (!confirmGlobalApply) return;
    }
    const hasContentChange = selectedItems.some((item) => item.requiresContentChange);
    if (hasContentChange) {
      const confirmApply = window.confirm(
        "所选优化项包含会改动内容的操作（如标点修正、分页控制等）。是否继续？"
      );
      if (!confirmApply) return;
    }

    setIsProcessing(true);
    setError(null);
    cancelTokenRef.current.cancelled = false;

    try {
      await applyChangePlan(sessionToApply, selectedChangeIds, {
        onProgress: (current, total, message) => setProgress({ current, total, message }),
        cancelToken: cancelTokenRef.current,
        headerFooterTemplate,
        typographyOptions,
        colorSelections,
      });
      setOperationLogs(getOperationLogs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUndo = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const ok = await undoLastOptimization();
      if (!ok) {
        setError("没有可撤销的优化批次");
      }
      setOperationLogs(getOperationLogs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    cancelTokenRef.current.cancelled = true;
    // 立即中断正在进行的fetch请求
    cancelTokenRef.current.abortController?.abort();
  };

  // 单独应用页眉页脚模板
  const handleApplyHeaderFooter = async () => {
    setIsProcessing(true);
    setError(null);
    setHeaderFooterApplied(false);
    try {
      const scope = buildScope();
      await addOperationLog("页眉页脚模板", "应用页眉页脚模板", scope, ["header-footer-template"]);
      await applyHeaderFooterTemplate(headerFooterTemplate);
      setHeaderFooterApplied(true);
      setOperationLogs(getOperationLogs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用页眉页脚失败");
    } finally {
      setIsProcessing(false);
    }
  };

  // 单独应用中英混排规范
  const handleApplyTypography = async () => {
    setIsProcessing(true);
    setError(null);
    setTypographyApplied(false);
    try {
      const scope = buildScope();
      const indices = await resolveScopeParagraphIndices(scope);
      await addOperationLog("中英混排规范", "规范中英文间距/标点，并按需映射字体", scope, ["mixed-typography"]);
      await applyTypographyNormalization(indices, typographyOptions);
      setTypographyApplied(true);
      setOperationLogs(getOperationLogs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用中英混排规范失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleHighlightScope = async () => {
    setError(null);
    try {
      const scope = buildScope();
      const indices = await resolveScopeParagraphIndices(scope);
      if (highlightedIndices.length > 0) {
        await clearParagraphHighlights(highlightedIndices);
      }
      await highlightParagraphs(indices);
      setHighlightedIndices(indices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "高亮失败");
    }
  };

  const handleClearHighlight = async () => {
    try {
      if (highlightedIndices.length > 0) {
        await clearParagraphHighlights(highlightedIndices);
        setHighlightedIndices([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "清除高亮失败");
    }
  };

  const renderFormatSpec = (spec: FormatSpecification | null) => {
    if (!spec) return "暂无格式规范";
    const items = [] as string[];
    if (spec.heading1) {
      items.push(
        `一级标题: ${spec.heading1.font.name || "默认"} ${spec.heading1.font.size || "默认"}pt ${spec.heading1.font.bold ? "粗体" : ""}`
      );
    }
    if (spec.heading2) {
      items.push(
        `二级标题: ${spec.heading2.font.name || "默认"} ${spec.heading2.font.size || "默认"}pt ${spec.heading2.font.bold ? "粗体" : ""}`
      );
    }
    if (spec.heading3) {
      items.push(
        `三级标题: ${spec.heading3.font.name || "默认"} ${spec.heading3.font.size || "默认"}pt ${spec.heading3.font.bold ? "粗体" : ""}`
      );
    }
    if (spec.bodyText) {
      items.push(
        `正文: ${spec.bodyText.font.name || "默认"} ${spec.bodyText.font.size || "默认"}pt`
      );
    }
    if (spec.listItem) {
      items.push(
        `列表: ${spec.listItem.font.name || "默认"} ${spec.listItem.font.size || "默认"}pt`
      );
    }
    return items.join("\n");
  };

  const formatIndices = (indices: number[]) => {
    if (indices.length === 0) return "-";
    const display = indices.slice(0, 12).map((idx) => idx + 1).join(", ");
    return indices.length > 12 ? `${display} ...` : display;
  };

  const toggleChangeItem = (id: string, checked: boolean) => {
    setSelectedChangeIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((itemId) => itemId !== id);
    });
  };

  const toggleColorSelection = (index: number, checked: boolean) => {
    setColorSelections((prev) => {
      if (checked) {
        return prev.includes(index) ? prev : [...prev, index];
      }
      return prev.filter((idx) => idx !== index);
    });
  };

  const issueCount = useMemo(() => {
    if (!analysisSession) return 0;
    return analysisSession.issues.reduce((sum, category) => sum + category.items.length, 0);
  }, [analysisSession]);

  return (
    <div className={styles.container}>
      <div className={styles.scrollContent}>
      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">范围选择</Text>}
        />
        <div className={styles.cardContent}>
          <RadioGroup
            value={scopeType}
            onChange={(_, data) => setScopeType(data.value as FormatScopeType)}
          >
            <div className={styles.scopeRow}>
              {scopeOptions.map((option) => (
                <Radio key={option.value} value={option.value} label={option.label} />
              ))}
            </div>
          </RadioGroup>

          {scopeType === "paragraphs" && (
            <Field hint="示例：1,3-5,8">
              <Input
                size="small"
                className={styles.indicesInput}
                value={indicesInput}
                onChange={(_, data) => setIndicesInput(data.value)}
                placeholder="段落索引"
              />
            </Field>
          )}

          <div className={styles.buttonRow}>
            <Button
              size="small"
              appearance="secondary"
              icon={<Search24Regular />}
              onClick={handleHighlightScope}
              disabled={isProcessing}
            >
              高亮
            </Button>
            <Button
              size="small"
              appearance="secondary"
              onClick={handleClearHighlight}
              disabled={isProcessing}
            >
              清除
            </Button>
            <Button
              size="small"
              appearance="primary"
              icon={<TextAlignLeft24Regular />}
              onClick={handleAnalyze}
              disabled={isProcessing}
            >
              分析
            </Button>
          </div>
        </div>
      </Card>

      {analysisSession && (
        <Card className={styles.card}>
          <CardHeader
            header={<Text weight="semibold">检测结果</Text>}
            action={
              <div className={styles.statsRow}>
                <div className={styles.statItem}>
                  <Badge appearance="filled" color="informative" size="small">
                    {analysisSession.paragraphCount}
                  </Badge>
                  <Text size={100}>段落</Text>
                </div>
                <div className={styles.statItem}>
                  <Badge appearance="filled" color="informative" size="small">
                    {analysisSession.sectionCount}
                  </Badge>
                  <Text size={100}>节</Text>
                </div>
                <div className={styles.statItem}>
                  <Badge appearance="filled" color={issueCount > 0 ? "danger" : "success"} size="small">
                    {issueCount}
                  </Badge>
                  <Text size={100}>问题</Text>
                </div>
              </div>
            }
          />
          <div className={styles.cardContent}>
            <Accordion collapsible defaultOpenItems={["spec"]}>
              <AccordionItem value="issues">
                <AccordionHeader>检测结果</AccordionHeader>
                <AccordionPanel>
                  {analysisSession.issues.map((category) => (
                    <div key={category.id} className={styles.resultSection}>
                      <div className={styles.issueMeta}>
                        <Text weight="semibold">{category.title}</Text>
                        <Badge appearance="filled" color="informative">
                          {category.items.length}
                        </Badge>
                      </div>
                      {category.items.length === 0 && (
                        <Text size={200}>暂无问题</Text>
                      )}
                      {category.items.map((issue) => (
                        <div key={issue.id} className={styles.listItem}>
                          <Warning20Regular
                            className={styles.listIcon}
                            primaryFill={tokens.colorPaletteYellowForeground1}
                          />
                          <div style={{ flex: 1 }}>
                            <Text size={200}>{issue.description}</Text>
                            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                              影响段落：{formatIndices(issue.paragraphIndices)}
                            </Text>
                          </div>
                          {issue.paragraphIndices.length > 0 && (
                            <Button
                              size="small"
                              appearance="subtle"
                              onClick={() => selectParagraphByIndex(issue.paragraphIndices[0])}
                            >
                              定位
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </AccordionPanel>
              </AccordionItem>

              <AccordionItem value="spec">
                <AccordionHeader>方案预览</AccordionHeader>
                <AccordionPanel>
                  <div className={styles.formatPreview}>
                    {renderFormatSpec(analysisSession.formatSpec)}
                  </div>
                  {analysisSession.suggestions.length > 0 && (
                    <div style={{ marginTop: "8px" }}>
                      {analysisSession.suggestions.map((suggestion, idx) => (
                        <div key={idx} className={styles.listItem}>
                          <Info20Regular
                            className={styles.listIcon}
                            primaryFill={tokens.colorPaletteBlueForeground2}
                          />
                          <Text size={200}>{suggestion}</Text>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: "8px" }}>
                    <Field label="正文行间距" hint="优先用快捷值；若无合适值请选择“自定义”">
                      <div className={styles.inlineRow}>
                        <Combobox
                          size="small"
                          value={
                            bodyLineSpacingOption === customBodyLineSpacingOption
                              ? "自定义"
                              : bodyLineSpacingOption
                          }
                          selectedOptions={[bodyLineSpacingOption]}
                          onOptionSelect={(_, data) => {
                            const optionValue = data.optionValue;
                            if (!optionValue) return;
                            setBodyLineSpacingOption(optionValue);
                            setError(null);
                            if (optionValue !== customBodyLineSpacingOption) {
                              setBodyLineSpacing(optionValue);
                            }
                          }}
                          freeform={false}
                          className={styles.indicesInput}
                        >
                          {bodyLineSpacingPresets.map((preset) => (
                            <Option key={preset} value={preset}>
                              {preset}
                            </Option>
                          ))}
                          <Option value={customBodyLineSpacingOption}>自定义</Option>
                        </Combobox>
                        {bodyLineSpacingOption === customBodyLineSpacingOption && (
                          <Input
                            size="small"
                            type="number"
                            min={0.5}
                            step={0.1}
                            value={bodyLineSpacing}
                            onChange={(_, data) => {
                              setBodyLineSpacing(data.value);
                              setError(null);
                            }}
                            className={styles.indicesInput}
                            placeholder="输入自定义行间距"
                          />
                        )}
                      </div>
                    </Field>
                  </div>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          </div>
        </Card>
      )}

      {analysisSession && (
        <Card className={styles.card}>
          <CardHeader
            header={<Text weight="semibold">变更清单</Text>}
          />
          <div className={styles.cardContent}>
            {analysisSession.changePlan.items.map((item) => (
              <div key={item.id} className={styles.changeItem}>
                <div className={styles.changeItemHeader}>
                  <Checkbox
                    checked={selectedChangeIds.includes(item.id)}
                    onChange={(_, data) => toggleChangeItem(item.id, data.checked === true)}
                    label={item.title}
                  />
                </div>
                <div className={styles.changeItemBody}>
                  <Text size={200}>{item.description}</Text>
                  <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                    影响段落：{formatIndices(item.paragraphIndices)}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysisSession && analysisSession.colorAnalysis.length > 0 && (
        <Card className={styles.card}>
          <CardHeader
            header={<Text weight="semibold">颜色标识治理</Text>}
          />
          <div className={styles.cardContent}>
            {analysisSession.colorAnalysis.map((item, idx) => (
              <div key={`${item.paragraphIndex}-${idx}`} className={styles.changeItem}>
                <div className={styles.inlineRow}>
                  <Checkbox
                    checked={colorSelections.includes(item.paragraphIndex)}
                    onChange={(_, data) =>
                      toggleColorSelection(item.paragraphIndex, data.checked === true)
                    }
                  />
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      backgroundColor: item.currentColor,
                      borderRadius: "2px",
                      display: "inline-block",
                    }}
                  />
                  <Text size={200}>{item.text || "(无文本)"}</Text>
                </div>
                <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                  建议：{item.suggestedColor} / {item.reason}
                </Text>
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysisSession && analysisSession.formatMarkAnalysis && analysisSession.formatMarkAnalysis.length > 0 && (
        <Card className={styles.card}>
          <CardHeader
            header={<Text weight="semibold">格式标记分析（下划线/斜体/删除线）</Text>}
          />
          <div className={styles.cardContent}>
            {analysisSession.formatMarkAnalysis.map((item, idx) => (
              <div key={`${item.paragraphIndex}-${item.formatType}-${idx}`} className={styles.changeItem}>
                <div className={styles.inlineRow}>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      backgroundColor: item.shouldKeep ? tokens.colorPaletteGreenBackground2 : tokens.colorPaletteRedBackground2,
                      color: item.shouldKeep ? tokens.colorPaletteGreenForeground2 : tokens.colorPaletteRedForeground2,
                    }}
                  >
                    {item.formatType === "underline" ? "下划线" : item.formatType === "italic" ? "斜体" : "删除线"}
                  </span>
                  <Text size={200}>{item.text || "(无文本)"}</Text>
                </div>
                <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                  {item.shouldKeep ? "保留" : "建议清除"} / {item.reason}
                </Text>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Accordion collapsible defaultOpenItems={[]}>
        <AccordionItem value="headerFooter">
          <AccordionHeader>
            <Text weight="semibold">页眉页脚模板</Text>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.cardContent}>
              <div className={styles.fieldRow}>
                <Field label="主页眉" className={styles.compactField}>
                  <Input
                    size="small"
                    value={headerFooterTemplate.primaryHeader}
                    onChange={(_, data) =>
                      setHeaderFooterTemplate((prev) => ({ ...prev, primaryHeader: data.value }))
                    }
                    placeholder="{documentName}"
                  />
                </Field>
                <Field label="主页脚" className={styles.compactField}>
                  <Input
                    size="small"
                    value={headerFooterTemplate.primaryFooter}
                    onChange={(_, data) =>
                      setHeaderFooterTemplate((prev) => ({ ...prev, primaryFooter: data.value }))
                    }
                    placeholder="第 {pageNumber} 页"
                  />
                </Field>
              </div>
              <div className={styles.inlineRow}>
                <Switch
                  checked={headerFooterTemplate.useDifferentFirstPage}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      useDifferentFirstPage: data.checked,
                    }))
                  }
                  label="首页不同"
                />
                <Switch
                  checked={headerFooterTemplate.useDifferentOddEven}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      useDifferentOddEven: data.checked,
                    }))
                  }
                  label="奇偶页不同"
                />
              </div>
              <div className={styles.inlineRow}>
                <Checkbox
                  checked={headerFooterTemplate.includeDocumentName}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      includeDocumentName: data.checked === true,
                    }))
                  }
                  label="文档名"
                />
                <Checkbox
                  checked={headerFooterTemplate.includePageNumber}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      includePageNumber: data.checked === true,
                    }))
                  }
                  label="页码"
                />
                <Checkbox
                  checked={headerFooterTemplate.includeDate}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      includeDate: data.checked === true,
                    }))
                  }
                  label="日期"
                />
              </div>
              {(headerFooterTemplate.useDifferentFirstPage || headerFooterTemplate.useDifferentOddEven) && (
                <>
                  {headerFooterTemplate.useDifferentFirstPage && (
                    <div className={styles.fieldRow}>
                      <Field label="首页页眉" className={styles.compactField}>
                        <Input
                          size="small"
                          value={headerFooterTemplate.firstPageHeader || ""}
                          onChange={(_, data) =>
                            setHeaderFooterTemplate((prev) => ({
                              ...prev,
                              firstPageHeader: data.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="首页页脚" className={styles.compactField}>
                        <Input
                          size="small"
                          value={headerFooterTemplate.firstPageFooter || ""}
                          onChange={(_, data) =>
                            setHeaderFooterTemplate((prev) => ({
                              ...prev,
                              firstPageFooter: data.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                  )}
                  {headerFooterTemplate.useDifferentOddEven && (
                    <div className={styles.fieldRow}>
                      <Field label="偶数页页眉" className={styles.compactField}>
                        <Input
                          size="small"
                          value={headerFooterTemplate.evenPageHeader || ""}
                          onChange={(_, data) =>
                            setHeaderFooterTemplate((prev) => ({
                              ...prev,
                              evenPageHeader: data.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="偶数页页脚" className={styles.compactField}>
                        <Input
                          size="small"
                          value={headerFooterTemplate.evenPageFooter || ""}
                          onChange={(_, data) =>
                            setHeaderFooterTemplate((prev) => ({
                              ...prev,
                              evenPageFooter: data.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                  )}
                </>
              )}
              <div className={styles.actionButtons}>
                <Button
                  appearance="primary"
                  size="small"
                  icon={<Play24Regular />}
                  onClick={handleApplyHeaderFooter}
                  disabled={isProcessing}
                >
                  应用
                </Button>
                <Button
                  appearance="secondary"
                  size="small"
                  icon={<ArrowUndo24Regular />}
                  onClick={handleUndo}
                  disabled={isProcessing}
                >
                  撤回
                </Button>
                {headerFooterApplied && (
                  <span className={styles.successMessage}>
                    <Checkmark20Regular />
                    已应用
                  </span>
                )}
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="typography">
          <AccordionHeader>
            <Text weight="semibold">中英混排规范</Text>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.cardContent}>
              <div className={styles.fieldRow}>
                <Field label="中文字体" className={styles.compactField}>
                  <Combobox
                    size="small"
                    value={typographyOptions.chineseFont}
                    selectedOptions={[typographyOptions.chineseFont]}
                    onOptionSelect={(_, data) =>
                      setTypographyOptions((prev) => ({
                        ...prev,
                        chineseFont: data.optionValue as string,
                      }))
                    }
                    freeform={false}
                    placeholder="搜索字体..."
                  >
                    {availableFonts.map((font) => (
                      <Option key={font} value={font}>
                        {font}
                      </Option>
                    ))}
                  </Combobox>
                </Field>
                <Field label="英文字体" className={styles.compactField}>
                  <Combobox
                    size="small"
                    value={typographyOptions.englishFont}
                    selectedOptions={[typographyOptions.englishFont]}
                    onOptionSelect={(_, data) =>
                      setTypographyOptions((prev) => ({
                        ...prev,
                        englishFont: data.optionValue as string,
                      }))
                    }
                    freeform={false}
                    placeholder="搜索字体..."
                  >
                    {availableFonts.map((font) => (
                      <Option key={font} value={font}>
                        {font}
                      </Option>
                    ))}
                  </Combobox>
                </Field>
              </div>
              <div className={styles.inlineRow}>
                <Checkbox
                  checked={typographyOptions.enforceSpacing}
                  onChange={(_, data) =>
                    setTypographyOptions((prev) => ({
                      ...prev,
                      enforceSpacing: data.checked === true,
                    }))
                  }
                  label="修正中英间距"
                />
                <Checkbox
                  checked={typographyOptions.enforcePunctuation}
                  onChange={(_, data) =>
                    setTypographyOptions((prev) => ({
                      ...prev,
                      enforcePunctuation: data.checked === true,
                    }))
                  }
                  label="修正标点"
                />
              </div>
              <div className={styles.inlineRow}>
                <Checkbox
                  checked={typographyOptions.applyFontMapping === true}
                  onChange={(_, data) =>
                    setTypographyOptions((prev) => ({
                      ...prev,
                      applyFontMapping: data.checked === true,
                    }))
                  }
                  label="应用字体映射"
                />
                <Checkbox
                  checked={typographyOptions.skipSensitiveContent !== false}
                  onChange={(_, data) =>
                    setTypographyOptions((prev) => ({
                      ...prev,
                      skipSensitiveContent: data.checked === true,
                    }))
                  }
                  label="跳过代码/链接/域字段"
                />
              </div>
              {typographyOptions.applyFontMapping === true && (
                <Field label="字体应用方式" className={styles.compactField}>
                  <Combobox
                    size="small"
                    value={
                      typographyOptions.fontApplicationMode === "paragraph"
                        ? "整段应用（覆盖更强）"
                        : "仅缺省文本（推荐）"
                    }
                    selectedOptions={[typographyOptions.fontApplicationMode || "defaultText"]}
                    onOptionSelect={(_, data) =>
                      setTypographyOptions((prev) => ({
                        ...prev,
                        fontApplicationMode:
                          (data.optionValue as TypographyOptions["fontApplicationMode"]) || "defaultText",
                      }))
                    }
                    freeform={false}
                    className={styles.indicesInput}
                  >
                    <Option value="defaultText">仅缺省文本（推荐）</Option>
                    <Option value="paragraph">整段应用（覆盖更强）</Option>
                  </Combobox>
                </Field>
              )}
              <div className={styles.actionButtons}>
                <Button
                  appearance="primary"
                  size="small"
                  icon={<Play24Regular />}
                  onClick={handleApplyTypography}
                  disabled={isProcessing}
                >
                  应用
                </Button>
                <Button
                  appearance="secondary"
                  size="small"
                  icon={<ArrowUndo24Regular />}
                  onClick={handleUndo}
                  disabled={isProcessing}
                >
                  撤回
                </Button>
                {typographyApplied && (
                  <span className={styles.successMessage}>
                    <Checkmark20Regular />
                    已应用
                  </span>
                )}
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">应用变更</Text>}
        />
        <div className={styles.cardContent}>
          <div className={styles.buttonRow}>
            <Button
              size="small"
              appearance="primary"
              icon={<Play24Regular />}
              onClick={handleApply}
              disabled={isProcessing || !analysisSession || selectedChangeIds.length === 0}
            >
              应用所选 ({selectedChangeIds.length})
            </Button>
            <Button
              size="small"
              appearance="secondary"
              icon={<ArrowUndo24Regular />}
              onClick={handleUndo}
              disabled={isProcessing}
            >
              撤销
            </Button>
          </div>

          {!analysisSession && (
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              请先选择范围并点击“分析”，再应用变更。
            </Text>
          )}
          {operationLogs.length > 0 && (
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              最近：{operationLogs[operationLogs.length - 1].summary}
            </Text>
          )}
        </div>
      </Card>

      {isProcessing && (
        <div className={styles.progressSection}>
          <Text size={200}>{progress.message || "处理中..."}</Text>
          <ProgressBar
            value={progress.total > 0 ? progress.current / progress.total : 0}
          />
          <Button
            size="small"
            appearance="primary"
            className={styles.cancelButton}
            icon={<Stop24Regular />}
            onClick={handleCancel}
          >
            中断
          </Button>
        </div>
      )}

      {error && (
        <div className={styles.resultSection}>
          <div className={styles.listItem}>
            <Warning20Regular
              className={styles.listIcon}
              primaryFill={tokens.colorPaletteRedForeground1}
            />
            <Text size={200}>{error}</Text>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default FormatPanel;
