import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  Button,
  Textarea,
  Spinner,
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Dropdown,
  Option,
  Divider,
} from "@fluentui/react-components";
import {
  TextEditStyle24Regular,
  ArrowSync24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  Sparkle24Regular,
  DocumentAdd24Regular,
} from "@fluentui/react-icons";
import {
  getSelectedText,
  replaceSelectedText,
  insertText,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
} from "../../utils/wordApi";
import {
  polishTextStream,
  translateTextStream,
  checkGrammarStream,
  generateContentStream,
  summarizeTextStream,
  continueWritingStream,
  StreamCallback,
} from "../../utils/aiService";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  inputSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  textarea: {
    width: "100%",
    "& textarea": {
      minHeight: "100px",
      maxHeight: "200px",
      overflow: "auto !important",
      boxSizing: "border-box",
    },
  },
  buttonGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  resultCard: {
    marginTop: "8px",
  },
  actionButtons: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
  dropdown: {
    minWidth: "150px",
  },
  sectionTitle: {
    marginBottom: "4px",
  },
});

type StyleType = "formal" | "casual" | "professional" | "creative";
type ActionType = "polish" | "translate" | "grammar" | "summarize" | "continue" | "generate" | null;

const AIWritingAssistant: React.FC = () => {
  const styles = useStyles();
  const [inputText, setInputText] = useState("");
  const [resultText, setResultText] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleType>("professional");

  // 获取选中文本的函数
  const fetchSelectedText = useCallback(async () => {
    try {
      const text = await getSelectedText();
      setInputText(text);
    } catch (error) {
      console.error("获取选中文本失败:", error);
    }
  }, []);

  // 组件加载时自动获取选中文本，并监听选择变化事件
  useEffect(() => {
    fetchSelectedText();

    const handler = () => {
      fetchSelectedText();
    };

    addSelectionChangedHandler(handler).catch((error) => {
      console.error("添加选择变化监听器失败:", error);
    });

    return () => {
      removeSelectionChangedHandler(handler).catch((error) => {
        console.error("移除选择变化监听器失败:", error);
      });
    };
  }, [fetchSelectedText]);

  const handleGetSelection = async () => {
    await fetchSelectedText();
  };

  const handleAction = async (action: ActionType) => {
    if (!inputText.trim()) return;
    setLoading(true);
    setCurrentAction(action);
    setResultText("");

    const onChunk: StreamCallback = (chunk: string, done: boolean) => {
      if (!done && chunk) {
        setResultText((prev) => prev + chunk);
      }
    };

    try {
      switch (action) {
        case "polish":
          await polishTextStream(inputText, onChunk);
          break;
        case "translate":
          await translateTextStream(inputText, onChunk);
          break;
        case "grammar":
          await checkGrammarStream(inputText, onChunk);
          break;
        case "summarize":
          await summarizeTextStream(inputText, onChunk);
          break;
        case "continue":
          await continueWritingStream(inputText, selectedStyle, onChunk);
          break;
        case "generate":
          await generateContentStream(inputText, selectedStyle, onChunk);
          break;
      }
    } catch (error) {
      console.error("处理失败:", error);
      setResultText("处理失败，请重试");
    } finally {
      setLoading(false);
      setCurrentAction(null);
    }
  };

  const handleReplace = async () => {
    if (!resultText.trim()) return;
    try {
      await replaceSelectedText(resultText);
    } catch (error) {
      console.error("替换文本失败:", error);
    }
  };

  const handleInsert = async () => {
    if (!resultText.trim()) return;
    try {
      await insertText(resultText);
    } catch (error) {
      console.error("插入文本失败:", error);
    }
  };

  const renderButtonContent = (action: ActionType, label: string) => {
    if (loading && currentAction === action) {
      return <Spinner size="tiny" />;
    }
    return label;
  };

  return (
    <div className={styles.container}>
      <div className={styles.inputSection}>
        <Button appearance="secondary" onClick={handleGetSelection}>
          刷新选中文本
        </Button>
        <Textarea
          className={styles.textarea}
          placeholder="输入文本或从文档中获取选中内容..."
          value={inputText}
          onChange={(_, data) => setInputText(data.value)}
          resize="vertical"
        />
      </div>

      <div className={styles.inputSection}>
        <Text weight="semibold" className={styles.sectionTitle}>文本优化</Text>
        <div className={styles.buttonGroup}>
          <Button
            icon={<TextEditStyle24Regular />}
            onClick={() => handleAction("polish")}
            disabled={loading || !inputText.trim()}
          >
            {renderButtonContent("polish", "润色")}
          </Button>
          <Button
            icon={<TextGrammarCheckmark24Regular />}
            onClick={() => handleAction("grammar")}
            disabled={loading || !inputText.trim()}
          >
            {renderButtonContent("grammar", "语法检查")}
          </Button>
          <Button
            icon={<Translate24Regular />}
            onClick={() => handleAction("translate")}
            disabled={loading || !inputText.trim()}
          >
            {renderButtonContent("translate", "翻译")}
          </Button>
        </div>
      </div>

      <Divider />

      <div className={styles.inputSection}>
        <Text weight="semibold" className={styles.sectionTitle}>AI 创作</Text>
        <div className={styles.buttonGroup}>
          <Dropdown
            className={styles.dropdown}
            value={
              selectedStyle === "formal" ? "正式" :
              selectedStyle === "casual" ? "轻松" :
              selectedStyle === "professional" ? "专业" : "创意"
            }
            onOptionSelect={(_, data) => {
              const styleMap: Record<string, StyleType> = {
                "正式": "formal",
                "轻松": "casual",
                "专业": "professional",
                "创意": "creative",
              };
              setSelectedStyle(styleMap[data.optionText || "professional"] || "professional");
            }}
          >
            <Option>正式</Option>
            <Option>轻松</Option>
            <Option>专业</Option>
            <Option>创意</Option>
          </Dropdown>
        </div>
        <div className={styles.buttonGroup}>
          <Button
            icon={<Sparkle24Regular />}
            onClick={() => handleAction("summarize")}
            disabled={loading || !inputText.trim()}
          >
            {renderButtonContent("summarize", "生成摘要")}
          </Button>
          <Button
            icon={<Sparkle24Regular />}
            onClick={() => handleAction("continue")}
            disabled={loading || !inputText.trim()}
          >
            {renderButtonContent("continue", "续写内容")}
          </Button>
          <Button
            icon={<Sparkle24Regular />}
            onClick={() => handleAction("generate")}
            disabled={loading || !inputText.trim()}
          >
            {renderButtonContent("generate", "生成内容")}
          </Button>
        </div>
      </div>

      {resultText && (
        <Card className={styles.resultCard}>
          <CardHeader header={<Text weight="semibold">处理结果</Text>} />
          <Textarea
            className={styles.textarea}
            value={resultText}
            onChange={(_, data) => setResultText(data.value)}
            resize="vertical"
          />
          <div className={styles.actionButtons}>
            <Button
              appearance="primary"
              icon={<ArrowSync24Regular />}
              onClick={handleReplace}
            >
              替换原文
            </Button>
            <Button
              appearance="secondary"
              icon={<DocumentAdd24Regular />}
              onClick={handleInsert}
            >
              插入到光标处
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default AIWritingAssistant;
