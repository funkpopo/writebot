import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import {
  Button,
  Textarea,
  Spinner,
  makeStyles,
  tokens,
  Card,
  Text,
  Dropdown,
  Option,
  Tooltip,
  mergeClasses,
} from "@fluentui/react-components";
import {
  TextEditStyle24Regular,
  ArrowSync24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  Sparkle24Regular,
  DocumentAdd24Regular,
  Send24Filled,
  ArrowClockwise24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
  Delete24Regular,
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

type StyleType = "formal" | "casual" | "professional" | "creative";
type ActionType = "polish" | "translate" | "grammar" | "summarize" | "continue" | "generate" | null;

// 消息类型定义
interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  action?: ActionType;
  timestamp: Date;
}

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    gap: "16px",
  },
  welcomeSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    padding: "24px",
    textAlign: "center",
  },
  welcomeTitle: {
    fontSize: "24px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    marginBottom: "8px",
  },
  welcomeSubtitle: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "24px",
  },
  quickActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    justifyContent: "center",
    maxWidth: "320px",
  },
  quickActionButton: {
    borderRadius: "16px",
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: "500",
    backgroundColor: tokens.colorNeutralBackground3,
    border: "none",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  inputContainer: {
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "16px",
    padding: "12px",
    marginTop: "auto",
  },
  textarea: {
    width: "100%",
    "& textarea": {
      minHeight: "100px",
      maxHeight: "150px",
      overflow: "auto !important",
      boxSizing: "border-box",
      backgroundColor: "transparent",
      border: "none",
      resize: "none",
      fontSize: "14px",
      lineHeight: "1.5",
    },
    "& .fui-Textarea__root": {
      backgroundColor: "transparent",
      border: "none",
    },
  },
  inputToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "8px",
    paddingTop: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  toolbarButton: {
    minWidth: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "8px",
  },
  toolbarButtonActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    "&:hover": {
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
  },
  sendButton: {
    minWidth: "36px",
    height: "36px",
    padding: "0",
    borderRadius: "50%",
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    "&:hover": {
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
    "&:disabled": {
      backgroundColor: tokens.colorNeutralBackground4,
      color: tokens.colorNeutralForegroundDisabled,
    },
  },
  styleDropdown: {
    minWidth: "80px",
    "& button": {
      borderRadius: "8px",
      height: "32px",
      fontSize: "12px",
    },
  },
  resultSection: {
    flex: 1,
    overflow: "auto",
  },
  resultCard: {
    borderRadius: "16px",
    boxShadow: tokens.shadow4,
    overflow: "hidden",
  },
  resultHeader: {
    padding: "16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  resultContent: {
    padding: "16px",
  },
  resultTextarea: {
    width: "100%",
    "& textarea": {
      minHeight: "100px",
      maxHeight: "200px",
      overflow: "auto !important",
      boxSizing: "border-box",
      fontSize: "14px",
      lineHeight: "1.6",
    },
  },
  actionButtons: {
    display: "flex",
    gap: "8px",
    padding: "12px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  actionButton: {
    borderRadius: "8px",
    flex: 1,
  },
  refreshButton: {
    position: "absolute",
    top: "8px",
    right: "8px",
  },
  // 对话窗口样式
  chatContainer: {
    flex: 1,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "8px 0",
  },
  messageWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  userMessageWrapper: {
    alignItems: "flex-end",
  },
  assistantMessageWrapper: {
    alignItems: "stretch",
  },
  messageLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "2px",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  messageBubble: {
    maxWidth: "90%",
    padding: "12px 16px",
    borderRadius: "16px",
    fontSize: "14px",
    lineHeight: "1.6",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  userBubble: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderBottomRightRadius: "4px",
  },
  assistantBubble: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    borderBottomLeftRadius: "4px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  assistantCard: {
    width: "100%",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: tokens.shadow4,
  },
  assistantCardHeader: {
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  assistantCardContent: {
    padding: "8px 12px",
  },
  assistantTextarea: {
    width: "100%",
    "& textarea": {
      minHeight: "60px",
      boxSizing: "border-box",
      fontSize: "14px",
      lineHeight: "1.6",
      backgroundColor: "transparent",
      border: "none",
      resize: "none",
      fieldSizing: "content",
    },
  },
  assistantActions: {
    display: "flex",
    gap: "8px",
    padding: "8px 12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  clearButton: {
    minWidth: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "8px",
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorPaletteRedForeground1,
    "&:hover": {
      backgroundColor: tokens.colorPaletteRedBackground3,
    },
  },
});

const styleLabels: Record<StyleType, string> = {
  formal: "正式",
  casual: "轻松",
  professional: "专业",
  creative: "创意",
};

const AIWritingAssistant: React.FC = () => {
  const styles = useStyles();
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleType>("professional");
  const [selectedAction, setSelectedAction] = useState<ActionType>("polish");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

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

    // 添加用户消息到历史
    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputText,
      action: action,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    const savedInput = inputText;
    setInputText("");
    setLoading(true);
    setCurrentAction(action);
    setStreamingContent("");

    // 使用 ref 累积文本，避免闭包问题
    let accumulatedText = "";

    const onChunk: StreamCallback = (chunk: string, done: boolean) => {
      if (!done && chunk) {
        accumulatedText += chunk;
        // 使用 flushSync 强制同步更新，确保流式输出实时显示
        flushSync(() => {
          setStreamingContent(accumulatedText);
        });
      }
    };

    try {
      switch (action) {
        case "polish":
          await polishTextStream(savedInput, onChunk);
          break;
        case "translate":
          await translateTextStream(savedInput, onChunk);
          break;
        case "grammar":
          await checkGrammarStream(savedInput, onChunk);
          break;
        case "summarize":
          await summarizeTextStream(savedInput, onChunk);
          break;
        case "continue":
          await continueWritingStream(savedInput, selectedStyle, onChunk);
          break;
        case "generate":
          await generateContentStream(savedInput, selectedStyle, onChunk);
          break;
      }

      // 添加 AI 回复到历史
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: accumulatedText,
        action: action,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      setStreamingContent("");
    } catch (error) {
      console.error("处理失败:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: "处理失败，请重试",
        action: action,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setStreamingContent("");
    } finally {
      setLoading(false);
      setCurrentAction(null);
    }
  };

  const handleReplace = async (content: string) => {
    if (!content.trim()) return;
    try {
      await replaceSelectedText(content);
    } catch (error) {
      console.error("替换文本失败:", error);
    }
  };

  const handleInsert = async (content: string) => {
    if (!content.trim()) return;
    try {
      await insertText(content);
    } catch (error) {
      console.error("插入文本失败:", error);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setStreamingContent("");
  };

  const handleUpdateMessage = (messageId: string, newContent: string) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.id === messageId ? { ...msg, content: newContent } : msg
      )
    );
  };

  // 自动调整 textarea 高度
  const autoResizeTextarea = (element: HTMLTextAreaElement | null) => {
    if (element) {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
  };

  // 使用 useEffect 在消息更新时调整所有 textarea 高度
  useEffect(() => {
    const textareas = document.querySelectorAll<HTMLTextAreaElement>(
      "[data-auto-resize='true']"
    );
    textareas.forEach(autoResizeTextarea);
  }, [messages, streamingContent]);

  const handleQuickAction = (action: ActionType) => {
    setSelectedAction(action);
    if (inputText.trim()) {
      handleAction(action);
    }
  };

  const handleSend = () => {
    if (inputText.trim() && selectedAction) {
      handleAction(selectedAction);
    }
  };

  const getActionIcon = (action: ActionType) => {
    switch (action) {
      case "polish": return <TextEditStyle24Regular />;
      case "translate": return <Translate24Regular />;
      case "grammar": return <TextGrammarCheckmark24Regular />;
      case "summarize": return <TextBulletListSquare24Regular />;
      case "continue": return <TextExpand24Regular />;
      case "generate": return <Wand24Regular />;
      default: return <Sparkle24Regular />;
    }
  };

  const getActionLabel = (action: ActionType) => {
    switch (action) {
      case "polish": return "润色";
      case "translate": return "翻译";
      case "grammar": return "语法检查";
      case "summarize": return "生成摘要";
      case "continue": return "续写内容";
      case "generate": return "生成内容";
      default: return "";
    }
  };

  return (
    <div className={styles.container}>
      {messages.length === 0 && !streamingContent && (
        <div className={styles.welcomeSection}>
          <Text className={styles.welcomeTitle}>AI 写作助手</Text>
          <Text className={styles.welcomeSubtitle}>
            选择文档中的文本，或在下方输入内容开始
          </Text>
          <div className={styles.quickActions}>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<TextEditStyle24Regular />}
              onClick={() => handleQuickAction("polish")}
            >
              润色文本
            </Button>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<Translate24Regular />}
              onClick={() => handleQuickAction("translate")}
            >
              翻译
            </Button>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<TextGrammarCheckmark24Regular />}
              onClick={() => handleQuickAction("grammar")}
            >
              语法检查
            </Button>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<TextBulletListSquare24Regular />}
              onClick={() => handleQuickAction("summarize")}
            >
              摘要
            </Button>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<TextExpand24Regular />}
              onClick={() => handleQuickAction("continue")}
            >
              续写
            </Button>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<Wand24Regular />}
              onClick={() => handleQuickAction("generate")}
            >
              生成
            </Button>
          </div>
        </div>
      )}

      {(messages.length > 0 || streamingContent) && (
        <div className={styles.chatContainer} ref={chatContainerRef}>
          {messages.map((message) => (
            <div
              key={message.id}
              className={mergeClasses(
                styles.messageWrapper,
                message.type === "user"
                  ? styles.userMessageWrapper
                  : styles.assistantMessageWrapper
              )}
            >
              {message.type === "user" ? (
                <>
                  <Text className={styles.messageLabel}>
                    {getActionLabel(message.action || null)} · 原文
                  </Text>
                  <div
                    className={mergeClasses(styles.messageBubble, styles.userBubble)}
                  >
                    {message.content}
                  </div>
                </>
              ) : (
                <>
                  <Text className={styles.messageLabel}>
                    {getActionLabel(message.action || null)} · 结果
                  </Text>
                  <Card className={styles.assistantCard}>
                    <div className={styles.assistantCardContent}>
                      <Textarea
                        className={styles.assistantTextarea}
                        value={message.content}
                        onChange={(_, data) =>
                          handleUpdateMessage(message.id, data.value)
                        }
                        textarea={{ "data-auto-resize": "true" } as React.TextareaHTMLAttributes<HTMLTextAreaElement>}
                        onInput={(e) => autoResizeTextarea(e.target as HTMLTextAreaElement)}
                        resize="none"
                      />
                    </div>
                    <div className={styles.assistantActions}>
                      <Button
                        className={styles.actionButton}
                        appearance="primary"
                        size="small"
                        icon={<ArrowSync24Regular />}
                        onClick={() => handleReplace(message.content)}
                      >
                        替换原文
                      </Button>
                      <Button
                        className={styles.actionButton}
                        appearance="secondary"
                        size="small"
                        icon={<DocumentAdd24Regular />}
                        onClick={() => handleInsert(message.content)}
                      >
                        插入
                      </Button>
                    </div>
                  </Card>
                </>
              )}
            </div>
          ))}

          {/* 流式输出中的内容 */}
          {streamingContent && (
            <div
              className={mergeClasses(
                styles.messageWrapper,
                styles.assistantMessageWrapper
              )}
            >
              <Text className={styles.messageLabel}>
                {getActionLabel(currentAction)} · 生成中...
              </Text>
              <Card className={styles.assistantCard}>
                <div className={styles.assistantCardContent}>
                  <Textarea
                    className={styles.assistantTextarea}
                    value={streamingContent}
                    textarea={{ "data-auto-resize": "true" } as React.TextareaHTMLAttributes<HTMLTextAreaElement>}
                    resize="none"
                    readOnly
                  />
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      <div className={styles.inputContainer}>
        <Textarea
          className={styles.textarea}
          placeholder="输入文本或从文档中选择内容..."
          value={inputText}
          onChange={(_, data) => setInputText(data.value)}
          appearance="filled-lighter"
        />
        <div className={styles.inputToolbar}>
          <div className={styles.toolbarLeft}>
            <Tooltip content="刷新选中文本" relationship="label">
              <Button
                className={styles.toolbarButton}
                appearance="transparent"
                icon={<ArrowClockwise24Regular />}
                onClick={handleGetSelection}
              />
            </Tooltip>
            {messages.length > 0 && (
              <Tooltip content="清空对话" relationship="label">
                <Button
                  className={styles.clearButton}
                  appearance="subtle"
                  icon={<Delete24Regular />}
                  onClick={handleClearChat}
                />
              </Tooltip>
            )}
            {(["polish", "translate", "grammar", "summarize", "continue", "generate"] as ActionType[]).map((action) => (
              <Tooltip key={action} content={getActionLabel(action)} relationship="label">
                <Button
                  className={mergeClasses(
                    styles.toolbarButton,
                    selectedAction === action && styles.toolbarButtonActive
                  )}
                  appearance={selectedAction === action ? "primary" : "transparent"}
                  icon={getActionIcon(action)}
                  onClick={() => setSelectedAction(action)}
                />
              </Tooltip>
            ))}
          </div>
          <div className={styles.toolbarRight}>
            {(selectedAction === "continue" || selectedAction === "generate") && (
              <Dropdown
                className={styles.styleDropdown}
                value={styleLabels[selectedStyle]}
                onOptionSelect={(_, data) => {
                  const styleMap: Record<string, StyleType> = {
                    "正式": "formal",
                    "轻松": "casual",
                    "专业": "professional",
                    "创意": "creative",
                  };
                  setSelectedStyle(styleMap[data.optionText || "professional"] || "professional");
                }}
                size="small"
              >
                <Option>正式</Option>
                <Option>轻松</Option>
                <Option>专业</Option>
                <Option>创意</Option>
              </Dropdown>
            )}
            <Button
              className={styles.sendButton}
              appearance="primary"
              icon={loading ? <Spinner size="tiny" /> : <Send24Filled />}
              onClick={handleSend}
              disabled={loading || !inputText.trim()}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIWritingAssistant;
