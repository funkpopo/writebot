import * as React from "react";
import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Text,
  ProgressBar,
  makeStyles,
  tokens,
  Divider,
  Badge,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from "@fluentui/react-components";
import {
  TextAlignLeft24Regular,
  DocumentHeader24Regular,
  Checkmark24Regular,
  Checkmark20Regular,
  Warning20Regular,
  Info20Regular,
  Info24Regular,
} from "@fluentui/react-icons";
import {
  analyzeAndGenerateFormatSpec,
  applyFormatSpecification,
  unifyHeadersFooters,
  getDocumentFormatPreview,
  FormatAnalysisResult,
  HeaderFooterUnifyPlan,
} from "../../utils/formatService";
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
  buttonGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
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
});

interface ProgressState {
  current: number;
  total: number;
  message: string;
}

const FormatPanel: React.FC = () => {
  const styles = useStyles();

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    current: 0,
    total: 0,
    message: "",
  });
  const [formatResult, setFormatResult] = useState<FormatAnalysisResult | null>(
    null
  );
  const [headerFooterPlan, setHeaderFooterPlan] =
    useState<HeaderFooterUnifyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documentInfo, setDocumentInfo] = useState<{
    paragraphCount: number;
    sectionCount: number;
  } | null>(null);

  const handleAnalyzeFormat = async () => {
    setIsProcessing(true);
    setError(null);
    setFormatResult(null);

    try {
      const result = await analyzeAndGenerateFormatSpec((current, total, msg) =>
        setProgress({ current, total, message: msg })
      );
      setFormatResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyFormat = async () => {
    if (!formatResult?.formatSpec) return;

    setIsProcessing(true);
    setError(null);

    try {
      await applyFormatSpecification(
        formatResult.formatSpec,
        (current, total, msg) =>
          setProgress({ current, total, message: msg })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用格式失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnifyHeaderFooter = async () => {
    setIsProcessing(true);
    setError(null);
    setHeaderFooterPlan(null);

    try {
      const plan = await unifyHeadersFooters((current, total, msg) =>
        setProgress({ current, total, message: msg })
      );
      setHeaderFooterPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "统一页眉页脚失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGetPreview = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const preview = await getDocumentFormatPreview();
      setDocumentInfo({
        paragraphCount: preview.paragraphCount,
        sectionCount: preview.sectionCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取预览失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const renderFormatSpec = (spec: FormatSpecification) => {
    const items = [];
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
    if (spec.bodyText) {
      items.push(
        `正文: ${spec.bodyText.font.name || "默认"} ${spec.bodyText.font.size || "默认"}pt`
      );
    }
    return items.join("\n");
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">AI 排版助手</Text>}
          description="智能分析文档格式并统一排版"
        />
        <div className={styles.cardContent}>
          <Button
            appearance="secondary"
            icon={<Info24Regular />}
            onClick={handleGetPreview}
            disabled={isProcessing}
          >
            获取文档信息
          </Button>

          {documentInfo && (
            <div className={styles.statsRow}>
              <div className={styles.statItem}>
                <Badge appearance="filled" color="informative">
                  {documentInfo.paragraphCount}
                </Badge>
                <Text size={200}>段落</Text>
              </div>
              <div className={styles.statItem}>
                <Badge appearance="filled" color="informative">
                  {documentInfo.sectionCount}
                </Badge>
                <Text size={200}>节</Text>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">格式统一</Text>}
          description="分析并统一文档中的格式"
        />
        <div className={styles.cardContent}>
          <div className={styles.buttonGroup}>
            <Button
              appearance="primary"
              icon={<TextAlignLeft24Regular />}
              onClick={handleAnalyzeFormat}
              disabled={isProcessing}
            >
              分析文档格式
            </Button>

            {formatResult && (
              <Button
                appearance="secondary"
                icon={<Checkmark24Regular />}
                onClick={handleApplyFormat}
                disabled={isProcessing}
              >
                应用格式规范
              </Button>
            )}
          </div>

          {formatResult && (
            <Accordion collapsible>
              <AccordionItem value="spec">
                <AccordionHeader>格式规范预览</AccordionHeader>
                <AccordionPanel>
                  <div className={styles.formatPreview}>
                    {renderFormatSpec(formatResult.formatSpec)}
                  </div>
                </AccordionPanel>
              </AccordionItem>

              {formatResult.inconsistencies.length > 0 && (
                <AccordionItem value="issues">
                  <AccordionHeader>
                    发现的问题 ({formatResult.inconsistencies.length})
                  </AccordionHeader>
                  <AccordionPanel>
                    {formatResult.inconsistencies.map((issue, i) => (
                      <div key={i} className={styles.listItem}>
                        <Warning20Regular
                          className={styles.listIcon}
                          primaryFill={tokens.colorPaletteYellowForeground1}
                        />
                        <Text size={200}>{issue}</Text>
                      </div>
                    ))}
                  </AccordionPanel>
                </AccordionItem>
              )}

              {formatResult.suggestions.length > 0 && (
                <AccordionItem value="suggestions">
                  <AccordionHeader>
                    建议 ({formatResult.suggestions.length})
                  </AccordionHeader>
                  <AccordionPanel>
                    {formatResult.suggestions.map((suggestion, i) => (
                      <div key={i} className={styles.listItem}>
                        <Info20Regular
                          className={styles.listIcon}
                          primaryFill={tokens.colorPaletteBlueForeground2}
                        />
                        <Text size={200}>{suggestion}</Text>
                      </div>
                    ))}
                  </AccordionPanel>
                </AccordionItem>
              )}
            </Accordion>
          )}
        </div>
      </Card>

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">页眉页脚</Text>}
          description="统一文档中的页眉页脚"
        />
        <div className={styles.cardContent}>
          <Button
            appearance="secondary"
            icon={<DocumentHeader24Regular />}
            onClick={handleUnifyHeaderFooter}
            disabled={isProcessing}
          >
            统一页眉页脚
          </Button>

          {headerFooterPlan && (
            <div className={styles.resultSection}>
              <div className={styles.listItem}>
                {headerFooterPlan.shouldUnify ? (
                  <Checkmark20Regular
                    className={styles.listIcon}
                    primaryFill={tokens.colorPaletteGreenForeground1}
                  />
                ) : (
                  <Info20Regular
                    className={styles.listIcon}
                    primaryFill={tokens.colorPaletteBlueForeground2}
                  />
                )}
                <Text size={200}>
                  {headerFooterPlan.shouldUnify
                    ? "已统一页眉页脚"
                    : "无需统一"}
                </Text>
              </div>
              <Text size={200}>{headerFooterPlan.reason}</Text>
            </div>
          )}
        </div>
      </Card>

      {isProcessing && (
        <div className={styles.progressSection}>
          <Text size={200}>{progress.message}</Text>
          <ProgressBar
            value={progress.total > 0 ? progress.current / progress.total : 0}
          />
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
