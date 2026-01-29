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
} from "@fluentui/react-components";
import {
  Warning20Regular,
  Info20Regular,
  TextAlignLeft24Regular,
  ArrowUndo24Regular,
  Play24Regular,
  Stop24Regular,
  Search24Regular,
} from "@fluentui/react-icons";
import {
  analyzeFormatSession,
  applyChangePlan,
  undoLastOptimization,
  getOperationLogs,
  resolveScopeParagraphIndices,
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
} from "../../utils/wordApi";
import { FormatSpecification } from "../../utils/wordApi";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  card: {
    padding: "16px",
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
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
    maxHeight: "200px",
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
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  indicesInput: {
    minWidth: "220px",
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
};

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

  useEffect(() => {
    if (analysisSession) {
      setSelectedChangeIds(analysisSession.changePlan.items.map((item) => item.id));
      const defaultSelections = analysisSession.colorAnalysis
        .filter((item) => !item.isReasonable)
        .map((item) => item.paragraphIndex);
      setColorSelections(defaultSelections);
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

  const handleAnalyze = async () => {
    setIsProcessing(true);
    setError(null);
    cancelTokenRef.current.cancelled = false;

    try {
      const session = await analyzeFormatSession(buildScope(), {
        onProgress: (current, total, message) => setProgress({ current, total, message }),
      });
      setAnalysisSession(session);
      setOperationLogs(getOperationLogs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = async () => {
    if (!analysisSession) return;

    setIsProcessing(true);
    setError(null);
    cancelTokenRef.current.cancelled = false;

    try {
      await applyChangePlan(analysisSession, selectedChangeIds, {
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
      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">范围选择</Text>}
          description="支持选区、当前节、全文或指定段落"
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
            <Field label="段落索引" hint="示例：1,3-5,8（输入为1-based）">
              <Input
                className={styles.indicesInput}
                value={indicesInput}
                onChange={(_, data) => setIndicesInput(data.value)}
                placeholder="请输入段落索引"
              />
            </Field>
          )}

          <div className={styles.buttonRow}>
            <Button
              appearance="secondary"
              icon={<Search24Regular />}
              onClick={handleHighlightScope}
              disabled={isProcessing}
            >
              高亮范围
            </Button>
            <Button
              appearance="secondary"
              onClick={handleClearHighlight}
              disabled={isProcessing}
            >
              清除高亮
            </Button>
          </div>
        </div>
      </Card>

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">检测与方案</Text>}
          description="分析文档问题并生成优化方案"
        />
        <div className={styles.cardContent}>
          <div className={styles.buttonRow}>
            <Button
              appearance="primary"
              icon={<TextAlignLeft24Regular />}
              onClick={handleAnalyze}
              disabled={isProcessing}
            >
              分析并生成方案
            </Button>
          </div>

          {analysisSession && (
            <div className={styles.statsRow}>
              <div className={styles.statItem}>
                <Badge appearance="filled" color="informative">
                  {analysisSession.paragraphCount}
                </Badge>
                <Text size={200}>段落</Text>
              </div>
              <div className={styles.statItem}>
                <Badge appearance="filled" color="informative">
                  {analysisSession.sectionCount}
                </Badge>
                <Text size={200}>节</Text>
              </div>
              <div className={styles.statItem}>
                <Badge appearance="filled" color={issueCount > 0 ? "danger" : "success"}>
                  {issueCount}
                </Badge>
                <Text size={200}>问题</Text>
              </div>
            </div>
          )}

          {analysisSession && (
            <Accordion collapsible>
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
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      </Card>

      {analysisSession && (
        <Card className={styles.card}>
          <CardHeader
            header={<Text weight="semibold">变更清单</Text>}
            description="支持逐项勾选与差异范围预览"
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
            description="可视化预览并选择性修正颜色"
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

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">页眉页脚模板</Text>}
          description="支持首页/奇偶页差异与字段"
        />
        <div className={styles.cardContent}>
          <Field label="主页眉">
            <Input
              value={headerFooterTemplate.primaryHeader}
              onChange={(_, data) =>
                setHeaderFooterTemplate((prev) => ({ ...prev, primaryHeader: data.value }))
              }
              placeholder="例如：{documentName}"
            />
          </Field>
          <Field label="主页脚">
            <Input
              value={headerFooterTemplate.primaryFooter}
              onChange={(_, data) =>
                setHeaderFooterTemplate((prev) => ({ ...prev, primaryFooter: data.value }))
              }
              placeholder="例如：第 {pageNumber} 页"
            />
          </Field>
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
              label="包含文档名"
            />
            <Checkbox
              checked={headerFooterTemplate.includePageNumber}
              onChange={(_, data) =>
                setHeaderFooterTemplate((prev) => ({
                  ...prev,
                  includePageNumber: data.checked === true,
                }))
              }
              label="包含页码"
            />
            <Checkbox
              checked={headerFooterTemplate.includeDate}
              onChange={(_, data) =>
                setHeaderFooterTemplate((prev) => ({
                  ...prev,
                  includeDate: data.checked === true,
                }))
              }
              label="包含日期"
            />
          </div>
          {(headerFooterTemplate.useDifferentFirstPage || headerFooterTemplate.useDifferentOddEven) && (
            <div className={styles.cardContent}>
              <Field label="首页页眉">
                <Input
                  value={headerFooterTemplate.firstPageHeader || ""}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      firstPageHeader: data.value,
                    }))
                  }
                />
              </Field>
              <Field label="首页页脚">
                <Input
                  value={headerFooterTemplate.firstPageFooter || ""}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      firstPageFooter: data.value,
                    }))
                  }
                />
              </Field>
              <Field label="偶数页页眉">
                <Input
                  value={headerFooterTemplate.evenPageHeader || ""}
                  onChange={(_, data) =>
                    setHeaderFooterTemplate((prev) => ({
                      ...prev,
                      evenPageHeader: data.value,
                    }))
                  }
                />
              </Field>
              <Field label="偶数页页脚">
                <Input
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
        </div>
      </Card>

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">中英混排规范</Text>}
          description="设置字体映射与标点/间距规则"
        />
        <div className={styles.cardContent}>
          <Field label="中文字体">
            <Input
              value={typographyOptions.chineseFont}
              onChange={(_, data) =>
                setTypographyOptions((prev) => ({ ...prev, chineseFont: data.value }))
              }
            />
          </Field>
          <Field label="英文字体">
            <Input
              value={typographyOptions.englishFont}
              onChange={(_, data) =>
                setTypographyOptions((prev) => ({ ...prev, englishFont: data.value }))
              }
            />
          </Field>
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
        </div>
      </Card>

      {analysisSession && (
        <Card className={styles.card}>
          <CardHeader
            header={<Text weight="semibold">应用与回退</Text>}
            description="一键应用所选优化并支持撤销"
          />
          <div className={styles.cardContent}>
            <div className={styles.buttonRow}>
              <Button
                appearance="primary"
                icon={<Play24Regular />}
                onClick={handleApply}
                disabled={isProcessing || selectedChangeIds.length === 0}
              >
                应用所选优化
              </Button>
              <Button
                appearance="secondary"
                icon={<ArrowUndo24Regular />}
                onClick={handleUndo}
                disabled={isProcessing}
              >
                撤销本次优化
              </Button>
            </div>

            {operationLogs.length > 0 && (
              <div className={styles.resultSection}>
                <Text size={200}>最近操作：{operationLogs[operationLogs.length - 1].summary}</Text>
              </div>
            )}
          </div>
        </Card>
      )}

      {isProcessing && (
        <div className={styles.progressSection}>
          <Text size={200}>{progress.message || "处理中..."}</Text>
          <ProgressBar
            value={progress.total > 0 ? progress.current / progress.total : 0}
          />
          <Button
            appearance="secondary"
            icon={<Stop24Regular />}
            onClick={handleCancel}
          >
            中断处理
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
  );
};

export default FormatPanel;
