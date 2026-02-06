import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
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
  ChevronDown24Regular,
  ChevronUp24Regular,
  Brain24Regular,
  TextEditStyle24Regular,
  ArrowSync24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  Sparkle24Regular,
  Send24Filled,
  ArrowClockwise24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
  Delete24Regular,
} from "@fluentui/react-icons";
import {
  getSelectedText,
  getDocumentOoxml,
  getDocumentBodyOoxml,
  restoreDocumentOoxml,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
  DocumentSnapshot,
} from "../../utils/wordApi";
import {
  polishTextStream,
  translateTextStream,
  checkGrammarStream,
  generateContentStream,
  summarizeTextStream,
  continueWritingStream,
  callAIWithToolsStream,
  type AIResponse,
  type StreamChunkMeta,
} from "../../utils/aiService";
import {
  saveConversation,
  loadConversation,
  clearConversation,
  getAndClearContextMenuResult,
  getContextMenuResultKey,
  StoredMessage,
} from "../../utils/storageService";
import { ConversationManager } from "../../utils/conversationManager";
import { ToolExecutor } from "../../utils/toolExecutor";
import { ToolCallRequest, ToolCallResult } from "../../types/tools";
import { TOOL_DEFINITIONS } from "../../utils/toolDefinitions";
import { getPrompt } from "../../utils/promptService";
import { sanitizeMarkdownToPlainText } from "../../utils/textSanitizer";
import { applyAiContentToWord, insertAiContentToWord } from "../../utils/wordContentApplier";
import MarkdownView from "./MarkdownView";
type StyleType = "formal" | "casual" | "professional" | "creative";
type ActionType =
  | "agent"
  | "polish"
  | "translate"
  | "grammar"
  | "summarize"
  | "continue"
  | "generate"
  | null;

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  plainText?: string;
  applyContent?: string;
  thinking?: string;
  action?: ActionType;
  uiOnly?: boolean;
  timestamp: Date;
}

function formatOriginalTextForBubble(input: string): string {
  const raw = typeof input === "string" ? input : String(input ?? "");

  // Normalize various line separators to LF so `white-space: pre-wrap` renders them consistently.
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Unicode line/paragraph separators (sometimes appear when copying content).
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n")
    // Vertical tab / form feed.
    .replace(/\v/g, "\n")
    .replace(/\f/g, "\n");

  const lines = normalized
    .split("\n")
    // Avoid trailing whitespace creating odd copy/paste artifacts.
    .map((line) => line.replace(/[ \t]+$/g, ""));

  // Remove blank lines for user-visible "原文".
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  return nonEmptyLines.join("\n");
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
    marginBottom: "16px",
  },
  quickActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    justifyContent: "center",
    maxWidth: "360px",
    marginBottom: "12px",
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
  exampleList: {
    textAlign: "left",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "12px",
    padding: "12px 16px",
    fontSize: "12px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
    maxWidth: "320px",
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
    backgroundColor: "#2B579A",
    color: "#ffffff",
    "&:hover": {
      backgroundColor: "#1E3F6F",
    },
  },
  sendButton: {
    minWidth: "36px",
    height: "36px",
    padding: "0",
    borderRadius: "50%",
    backgroundColor: "#2B579A",
    color: "#ffffff",
    "&:hover": {
      backgroundColor: "#1E3F6F",
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
  clearButton: {
    minWidth: "32px",
    height: "32px",
    padding: "0",
    borderRadius: "8px",
    backgroundColor: "#D13438",
    color: "#ffffff",
    "&:hover": {
      backgroundColor: "#A4262C",
      color: "#ffffff",
    },
  },
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
    backgroundColor: "#2B579A",
    color: "#ffffff",
    borderBottomRightRadius: "4px",
  },
  assistantCard: {
    width: "100%",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: tokens.shadow4,
  },
  assistantCardContent: {
    padding: "8px 12px",
  },
  assistantActions: {
    display: "flex",
    gap: "8px",
    padding: "8px 12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  assistantContent: {
    padding: "12px",
    fontSize: "14px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground1,
    wordBreak: "break-word",
    minHeight: "40px",
  },
  markdownContent: {
    // Make common Markdown elements look good inside the assistant card.
    "& p": { margin: "0 0 8px 0" },
    "& p:last-child": { marginBottom: 0 },
    "& h1": { margin: "0 0 10px 0", fontSize: "18px", fontWeight: "600" },
    "& h2": { margin: "0 0 10px 0", fontSize: "16px", fontWeight: "600" },
    "& h3": { margin: "0 0 8px 0", fontSize: "15px", fontWeight: "600" },
    "& h4": { margin: "0 0 8px 0", fontSize: "14px", fontWeight: "600" },
    "& h5": { margin: "0 0 8px 0", fontSize: "13px", fontWeight: "600" },
    "& h6": { margin: "0 0 8px 0", fontSize: "13px", fontWeight: "600" },
    "& ul, & ol": { margin: "0 0 8px 0", paddingLeft: "20px" },
    "& li": { marginBottom: "4px" },
    "& blockquote": {
      margin: "0 0 8px 0",
      padding: "8px 12px",
      borderLeft: `3px solid ${tokens.colorNeutralStroke2}`,
      backgroundColor: tokens.colorNeutralBackground2,
      borderRadius: "10px",
      color: tokens.colorNeutralForeground2,
    },
    "& hr": {
      border: "none",
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      margin: "10px 0",
    },
    "& a": {
      color: tokens.colorBrandForeground1,
      textDecoration: "underline",
    },
    "& pre": {
      margin: "0 0 8px 0",
      padding: "10px 12px",
      backgroundColor: tokens.colorNeutralBackground2,
      borderRadius: "10px",
      overflowX: "auto",
    },
    "& code": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
      fontSize: "13px",
      backgroundColor: tokens.colorNeutralBackground2,
      borderRadius: "6px",
      padding: "2px 6px",
    },
    "& pre code": {
      backgroundColor: "transparent",
      padding: "0",
      borderRadius: "0",
    },
    "& table": {
      width: "100%",
      borderCollapse: "collapse",
      margin: "0 0 8px 0",
      fontSize: "13px",
    },
    "& th, & td": {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: "6px 8px",
      verticalAlign: "top",
    },
    "& th": {
      backgroundColor: tokens.colorNeutralBackground2,
      fontWeight: "600",
    },
  },
  markdownEditor: {
    width: "100%",
    "& textarea": {
      minHeight: "160px",
      maxHeight: "320px",
      overflow: "auto !important",
      fontSize: "13px",
      lineHeight: "1.6",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    },
  },
  actionButton: {
    borderRadius: "8px",
    flex: 1,
  },
  thinkingSection: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  thinkingHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    backgroundColor: tokens.colorNeutralBackground2,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  thinkingIcon: {
    color: tokens.colorBrandForeground1,
  },
  thinkingLabel: {
    fontSize: "12px",
    fontWeight: "500",
    color: tokens.colorNeutralForeground2,
    flex: 1,
  },
  thinkingContent: {
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: "13px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "200px",
    overflow: "auto",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  toolPanel: {
    borderRadius: "12px",
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  toolItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  toolResultContent: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  statusBar: {
    borderRadius: "10px",
    padding: "8px 12px",
    backgroundColor: tokens.colorNeutralBackground2,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  statusSuccess: {
    color: tokens.colorPaletteGreenForeground1,
  },
  statusError: {
    color: tokens.colorPaletteRedForeground1,
  },
  statusWarning: {
    color: tokens.colorPaletteYellowForeground1,
  },
});

const styleLabels: Record<StyleType, string> = {
  formal: "正式",
  casual: "轻松",
  professional: "专业",
  creative: "创意",
};

const MAX_TOOL_LOOPS = 6;

const AIWritingAssistant: React.FC = () => {
  const styles = useStyles();
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleType>("professional");
  const [selectedAction, setSelectedAction] = useState<ActionType>("agent");
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = loadConversation();
    return stored.map((msg) => ({
      ...msg,
      plainText: msg.plainText || (msg.type === "assistant" ? sanitizeMarkdownToPlainText(msg.content) : undefined),
      action: msg.action as ActionType,
      timestamp: new Date(msg.timestamp),
    }));
  });
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingThinkingExpanded, setStreamingThinkingExpanded] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [editingMessageIds, setEditingMessageIds] = useState<Set<string>>(new Set());
  const [conversationManager] = useState(() => new ConversationManager());
  const [toolExecutor] = useState(() => new ToolExecutor());
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());
  const [agentStatus, setAgentStatus] = useState<{
    state: "idle" | "running" | "success" | "error";
    message?: string;
  }>({ state: "idle" });
  const [applyStatus, setApplyStatus] = useState<{
    state: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const appliedSnapshotsRef = useRef<Map<string, DocumentSnapshot>>(new Map());
  const pendingAgentSnapshotRef = useRef<DocumentSnapshot | null>(null);
  const lastAgentOutputRef = useRef<string | null>(null);
  const agentHasToolOutputsRef = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // Avoid overlapping Word.run calls (e.g. selection-change polling vs apply/snapshot).
  const wordBusyRef = useRef(false);

  useEffect(() => {
    const storedMessages: StoredMessage[] = messages.map((msg) => ({
      id: msg.id,
      type: msg.type,
      content: msg.content,
      plainText: msg.plainText,
      thinking: msg.thinking,
      action: msg.action || undefined,
      uiOnly: msg.uiOnly,
      timestamp: msg.timestamp.toISOString(),
    }));
    saveConversation(storedMessages);
  }, [messages]);

  useEffect(() => {
    const stored = loadConversation();
    stored.forEach((msg) => {
      if (msg.uiOnly) return;
      if (msg.type === "user") {
        conversationManager.addUserMessage(msg.content);
      } else {
        conversationManager.addAssistantMessage(msg.content, undefined, msg.thinking);
      }
    });
  }, [conversationManager]);

  useEffect(() => {
    const appendContextMenuResult = async () => {
      const pendingResult = await getAndClearContextMenuResult();
      if (!pendingResult) return;
      const userMessage: Message = {
        id: pendingResult.id,
        type: "user",
        content: pendingResult.originalText,
        action: pendingResult.action as ActionType,
        timestamp: new Date(pendingResult.timestamp),
      };
      const assistantMessage: Message = {
        id: pendingResult.id + "_result",
        type: "assistant",
        content: pendingResult.resultText,
        plainText: sanitizeMarkdownToPlainText(pendingResult.resultText),
        thinking: pendingResult.thinking,
        action: pendingResult.action as ActionType,
        timestamp: new Date(pendingResult.timestamp),
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      conversationManager.addUserMessage(pendingResult.originalText);
      conversationManager.addAssistantMessage(
        pendingResult.resultText,
        undefined,
        pendingResult.thinking
      );
    };

    void appendContextMenuResult();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === getContextMenuResultKey() && event.newValue) {
        void appendContextMenuResult();
      }
    };

    window.addEventListener("storage", handleStorageChange);

    const officeStorage = typeof OfficeRuntime !== "undefined" ? OfficeRuntime.storage : undefined;
    const handleOfficeStorageChange = (args: {
      changedItems?: Array<{ key: string; newValue?: string }> | Record<string, { newValue?: string }>;
    }) => {
      const key = getContextMenuResultKey();
      const changedItems = args?.changedItems;
      if (Array.isArray(changedItems)) {
        if (changedItems.some((item) => item.key === key && item.newValue)) {
          void appendContextMenuResult();
        }
        return;
      }
      if (changedItems && typeof changedItems === "object") {
        if (changedItems[key]?.newValue) {
          void appendContextMenuResult();
        }
      }
    };

    if (officeStorage?.onChanged?.addListener) {
      officeStorage.onChanged.addListener(handleOfficeStorageChange);
    }

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      if (officeStorage?.onChanged?.removeListener) {
        officeStorage.onChanged.removeListener(handleOfficeStorageChange);
      }
    };
  }, [conversationManager]);

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingContent, streamingThinking, scrollToBottom]);

  const fetchSelectedText = useCallback(async () => {
    try {
      if (wordBusyRef.current) return;
      const text = await getSelectedText();
      setInputText(text);
    } catch (error) {
      console.error("获取选中文本失败:", error);
    }
  }, []);

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

  const addMessage = (message: Message) => {
    setMessages((prev) => [...prev, message]);
  };

  const toggleThinking = (messageId: string) => {
    setExpandedThinking((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const toggleEditing = (messageId: string) => {
    setEditingMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const handleUpdateMessage = (messageId: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
            ...msg,
            content: newContent,
            plainText: msg.type === "assistant" ? sanitizeMarkdownToPlainText(newContent) : msg.plainText,
            applyContent: msg.type === "assistant" ? newContent : msg.applyContent,
          }
          : msg
      )
    );
  };

  const isStatusLikeContent = (content: string): boolean => {
    const trimmed = content.trim();
    if (!trimmed) return true;
    if (trimmed.length > 140) return false;
    const statusKeywords = ["已完成", "完成", "失败", "已执行", "执行失败", "文档已更新", "已更新"];
    return statusKeywords.some((keyword) => trimmed.includes(keyword));
  };

  const STATUS_TAG = "[[STATUS]]";
  const CONTENT_TAG = "[[CONTENT]]";

  const parseTaggedAgentContent = (
    rawContent: string
  ): { statusText: string; contentText: string; hasTaggedOutput: boolean } => {
    const source = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
    const statusIndex = source.indexOf(STATUS_TAG);
    const contentIndex = source.indexOf(CONTENT_TAG);

    if (statusIndex < 0 && contentIndex < 0) {
      return {
        statusText: "",
        contentText: source.trim(),
        hasTaggedOutput: false,
      };
    }

    const statusStart = statusIndex >= 0 ? statusIndex + STATUS_TAG.length : -1;
    const contentStart = contentIndex >= 0 ? contentIndex + CONTENT_TAG.length : -1;

    const statusText = statusStart >= 0
      ? source.slice(statusStart, contentIndex >= 0 ? contentIndex : source.length).trim()
      : "";

    const contentText = contentStart >= 0
      ? source.slice(contentStart).trim()
      : "";

    return {
      statusText,
      contentText,
      hasTaggedOutput: true,
    };
  };

  const markApplied = (messageId: string) => {
    setAppliedMessageIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  };

  const unmarkApplied = (messageId: string) => {
    setAppliedMessageIds((prev) => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  };

  const requestUserConfirmation = (
    message: string,
    options?: { defaultWhenUnavailable?: boolean }
  ): { confirmed: boolean; usedFallback: boolean } => {
    try {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        return {
          confirmed: window.confirm(message),
          usedFallback: false,
        };
      }
    } catch (error) {
      console.warn("当前环境不支持确认弹窗，已使用默认确认结果。", error);
    }

    return {
      confirmed: options?.defaultWhenUnavailable ?? false,
      usedFallback: true,
    };
  };

  const applyContentToDocument = async (
    content: string
  ): Promise<{
    status: "applied" | "cancelled";
    toolName?: "replace_selected_text" | "insert_text";
  }> => {
    const selectedText = await getSelectedText();
    const hasSelection = selectedText.trim().length > 0;

    // Align manual apply with agent auto-apply behavior:
    // - has selection: same as replace_selected_text (preserve style, no Markdown re-render)
    // - no selection: same as insert_text at cursor
    if (hasSelection) {
      const result = await applyAiContentToWord(content, {
        preserveSelectionFormat: true,
        renderMarkdownWhenPreserveFormat: false,
      });
      return {
        status: result,
        toolName: result === "applied" ? "replace_selected_text" : undefined,
      };
    }

    const { confirmed } = requestUserConfirmation("未检测到选中文本，将在光标位置插入内容，是否继续？", {
      defaultWhenUnavailable: true,
    });
    if (!confirmed) {
      return { status: "cancelled" };
    }

    const result = await insertAiContentToWord(content, { location: "cursor" });
    return {
      status: result,
      toolName: result === "applied" ? "insert_text" : undefined,
    };
  };

  const handleApply = async (message: Message) => {
    const latestMessage = messages.find((msg) => msg.id === message.id);
    const content = latestMessage?.applyContent ?? latestMessage?.content ?? message.content;
    if (!content.trim()) return;
    if (appliedMessageIds.has(message.id) || applyingMessageIds.has(message.id)) return;
    setApplyStatus(null);
    setApplyingMessageIds((prev) => {
      const next = new Set(prev);
      next.add(message.id);
      return next;
    });
    let snapshot: DocumentSnapshot | null = null;
    let snapshotErrorMessage: string | null = null;
    wordBusyRef.current = true;
    try {
      try {
        snapshot = await getDocumentBodyOoxml();
      } catch (snapshotError) {
        snapshotErrorMessage =
          snapshotError instanceof Error
            ? snapshotError.message
            : typeof snapshotError === "string"
              ? snapshotError
              : null;
        console.warn("获取文档快照失败，将继续应用内容:", snapshotError);
      }
      const result = await applyContentToDocument(content);
      if (result.status === "cancelled") return;

      const appliedToolName = result.toolName || "insert_text";
      const appliedToolLabelMap: Record<"insert_text" | "replace_selected_text", string> = {
        insert_text: "插入文本",
        replace_selected_text: "替换选中文本",
      };
      const appliedToolLabel = `${appliedToolLabelMap[appliedToolName]}（${appliedToolName}）`;

      if (snapshot) {
        appliedSnapshotsRef.current.set(message.id, snapshot);
        setApplyStatus({
          state: "success",
          message: `已执行：${appliedToolLabel}`,
        });
      } else {
        const detail = snapshotErrorMessage
          ? `(${snapshotErrorMessage.slice(0, 120)})`
          : "";
        setApplyStatus({
          state: "warning",
          message: `已执行：${appliedToolLabel}，但未能创建撤回快照${detail}；可在 Word 中使用 Ctrl+Z 撤销。`,
        });
      }
      markApplied(message.id);
    } catch (error) {
      console.error("应用失败:", error);
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "应用失败，请重试。",
      });
    } finally {
      setApplyingMessageIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
      wordBusyRef.current = false;
    }
  };

  const handleUndoApply = async (messageId: string) => {
    const snapshot = appliedSnapshotsRef.current.get(messageId);
    if (!snapshot) {
      setApplyStatus({
        state: "warning",
        message: "未找到撤回快照，无法撤回该内容。",
      });
      return;
    }
    try {
      await restoreDocumentOoxml(snapshot);
      // Agent tool executions may generate multiple UI messages but share the same pre-change snapshot.
      // When the user clicks "撤回" on any of them, revert all messages that point to that snapshot.
      const entries = Array.from(appliedSnapshotsRef.current.entries());
      for (const [id, snap] of entries) {
        if (snap === snapshot) {
          appliedSnapshotsRef.current.delete(id);
          unmarkApplied(id);
        }
      }
    } catch (error) {
      console.error("撤回失败:", error);
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "撤回失败，请重试。",
      });
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setStreamingContent("");
    setStreamingThinking("");
    setExpandedThinking(new Set());
    setEditingMessageIds(new Set());
    setAppliedMessageIds(new Set());
    setApplyingMessageIds(new Set());
    setApplyStatus(null);
    setAgentStatus({ state: "idle" });
    appliedSnapshotsRef.current.clear();
    pendingAgentSnapshotRef.current = null;
    lastAgentOutputRef.current = null;
    clearConversation();
    conversationManager.clear();
  };

  const getEnabledTools = () => {
    return TOOL_DEFINITIONS;
  };

  const executeToolCalls = async (toolCalls: ToolCallRequest[]) => {
    if (!pendingAgentSnapshotRef.current) {
      try {
        pendingAgentSnapshotRef.current = await getDocumentOoxml();
      } catch (error) {
        console.error("获取文档快照失败:", error);
      }
    }

    const snapshotForUndo = pendingAgentSnapshotRef.current;
    const labelMap: Record<string, string> = {
      insert_text: "插入文本",
      append_text: "追加文本",
      replace_selected_text: "替换选中文本",
    };

    const toolTitle = (toolName: string, index: number): string => {
      const base = labelMap[toolName] ? `${labelMap[toolName]}（${toolName}）` : toolName;
      return `#### 工具调用 ${index + 1}：${base}`;
    };

    const appendAgentToolOutput = (toolName: string, toolIndex: number, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      agentHasToolOutputsRef.current = true;

      // Keep a combined fallback (used when the model returns a short status-only message at the end).
      lastAgentOutputRef.current = lastAgentOutputRef.current
        ? `${lastAgentOutputRef.current.trimEnd()}\n\n${trimmed}`
        : trimmed;

      const messageId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      addMessage({
        id: messageId,
        type: "assistant",
        content: `${toolTitle(toolName, toolIndex)}\n\n${trimmed}`.trimEnd(),
        plainText: sanitizeMarkdownToPlainText(trimmed),
        applyContent: trimmed,
        action: "agent",
        uiOnly: true,
        timestamp: new Date(),
      });

      // Tool calls have already modified the document; disable "应用" and allow "撤回" when possible.
      markApplied(messageId);
      if (snapshotForUndo) {
        appliedSnapshotsRef.current.set(messageId, snapshotForUndo);
      }
    };

    const isAutoAppliedTool = (toolName: string): boolean => {
      return ["insert_text", "append_text", "replace_selected_text"].includes(toolName);
    };

    const pushUnique = (arr: string[], value: string) => {
      if (!arr.includes(value)) arr.push(value);
    };

    const formatToolList = (labels: string[]): string => {
      if (labels.length === 0) return "";
      const maxItems = 4;
      if (labels.length <= maxItems) return labels.join("、");
      return `${labels.slice(0, maxItems).join("、")} 等 ${labels.length} 项`;
    };

    const autoAppliedToolLabels: string[] = [];
    const failedToolLabels: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const maybeTextArg =
        call.arguments && typeof call.arguments === "object"
          ? (call.arguments as { text?: unknown }).text
          : undefined;
      let result: ToolCallResult;
      if (call.name === "restore_snapshot") {
        const confirmation = requestUserConfirmation("将把文档恢复到本轮 AI 操作前的状态，是否继续？", {
          defaultWhenUnavailable: false,
        });
        if (!confirmation.confirmed) {
          result = {
            id: call.id,
            name: call.name,
            success: false,
            error: confirmation.usedFallback
              ? "当前环境不支持确认弹窗，已取消恢复操作"
              : "用户取消恢复操作",
          };
        } else {
          result = await toolExecutor.execute(call);
        }
      } else {
        result = await toolExecutor.execute(call);
      }

      conversationManager.addToolResult(result);

      const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
      if (result.success && isAutoAppliedTool(call.name)) {
        pushUnique(autoAppliedToolLabels, toolLabel);
      }
      if (!result.success) {
        pushUnique(failedToolLabels, toolLabel);
      }

      // Display each "text-writing" tool output as its own assistant reply so new content won't overwrite old.
      if (
        result.success
        && typeof maybeTextArg === "string"
        && maybeTextArg.trim()
        && isAutoAppliedTool(call.name)
      ) {
        appendAgentToolOutput(call.name, i, maybeTextArg);
      }
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length === 0) {
      setApplyStatus({
        state: "success",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}`,
      });
      return;
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length > 0) {
      setApplyStatus({
        state: "warning",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}；但以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
      return;
    }

    if (failedToolLabels.length > 0) {
      setApplyStatus({
        state: "error",
        message: `以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
    }
  };

  const runAgentLoop = async () => {
    const tools = getEnabledTools();
    lastAgentOutputRef.current = null;
    pendingAgentSnapshotRef.current = null;
    agentHasToolOutputsRef.current = false;
    const agentSystemPrompt = getPrompt("assistant_agent");

    for (let round = 0; round < MAX_TOOL_LOOPS; round++) {
      // Stream the agent output so the user can see progress (similar to other actions).
      setStreamingContent("");
      setStreamingThinking("");
      setStreamingThinkingExpanded(false);

      // Note: tool-call argument streaming (e.g. insert_text.text) is for UI only. We must not
      // treat it as assistant "content" in the conversation history, otherwise the model will
      // see duplicated text in the next round.
      let streamedAssistantContent = "";
      let streamedThinking = "";
      const toolTextByCallId: Record<string, { toolName?: string; text: string }> = {};
      const toolCallOrder: string[] = [];
      let streamedToolCalls: ToolCallRequest[] | undefined;

      const toolTitle = (toolName?: string, index?: number): string => {
        const labelMap: Record<string, string> = {
          insert_text: "插入文本",
          append_text: "追加文本",
          replace_selected_text: "替换选中文本",
        };
        const base = toolName ? (labelMap[toolName] ? `${labelMap[toolName]}（${toolName}）` : toolName) : "工具调用";
        const prefix = typeof index === "number" ? `工具调用 ${index + 1}：` : "工具调用：";
        return `#### ${prefix}${base}`;
      };

      const buildStreamingDisplay = (): string => {
        const parts: string[] = [];
        if (streamedAssistantContent.trim()) {
          parts.push(streamedAssistantContent.trimEnd());
        }

        if (toolCallOrder.length > 0) {
          const sections = toolCallOrder.map((callId, idx) => {
            const entry = toolTextByCallId[callId];
            const title = toolTitle(entry?.toolName, idx);
            const body = entry?.text ?? "";
            return `${title}\n\n${body}`.trimEnd();
          });
          parts.push(sections.join("\n\n---\n\n"));
        }

        return parts.join("\n\n").trimEnd();
      };

      const onChunk = (
        chunk: string,
        done: boolean,
        isThinking?: boolean,
        meta?: StreamChunkMeta
      ) => {
        if (done) return;
        if (!chunk) return;
        if (isThinking) {
          streamedThinking += chunk;
          setStreamingThinking((prev) => prev + chunk);
        } else {
          if (meta?.kind === "tool_text") {
            const callId = meta.toolCallId || meta.toolName || "tool_call";
            if (!toolTextByCallId[callId]) {
              toolTextByCallId[callId] = { toolName: meta.toolName, text: "" };
              toolCallOrder.push(callId);
            }
            if (!toolTextByCallId[callId].toolName && meta.toolName) {
              toolTextByCallId[callId].toolName = meta.toolName;
            }
            toolTextByCallId[callId].text += chunk;
          } else {
            streamedAssistantContent += chunk;
          }

          // Re-render streaming display so tool calls are grouped even if chunks interleave.
          setStreamingContent(buildStreamingDisplay());
        }
      };

      await callAIWithToolsStream(
        conversationManager.getMessages(),
        tools,
        agentSystemPrompt,
        onChunk,
        (toolCalls) => {
          streamedToolCalls = toolCalls;
        }
      );

      // Mirror aiService's <think> handling so the final message doesn't show the tag.
      let thinking: string | undefined =
        streamedThinking.trim().length > 0 ? streamedThinking : undefined;
      let content = streamedAssistantContent;
      if (!thinking && content) {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          thinking = thinkMatch[1].trim();
          content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
        }
      }

      const rawMarkdown = content.trim();
      const plainText = sanitizeMarkdownToPlainText(rawMarkdown);

      const response = {
        content: rawMarkdown,
        rawMarkdown,
        plainText,
        thinking,
        toolCalls: streamedToolCalls,
      };

      const parsedConversation = parseTaggedAgentContent(response.rawMarkdown);
      const conversationContent =
        parsedConversation.contentText
        || parsedConversation.statusText
        || response.rawMarkdown;

      conversationManager.addAssistantMessage(
        conversationContent,
        response.toolCalls,
        response.thinking
      );

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const parsedTagged = parseTaggedAgentContent(response.rawMarkdown);
        const fallbackContent = lastAgentOutputRef.current || "";
        const normalizedContent = parsedTagged.contentText.trim();
        const normalizedStatus = parsedTagged.statusText.trim();
        const inferredStatusText = normalizedContent
          ? sanitizeMarkdownToPlainText(normalizedContent).trim()
          : response.plainText.trim();
        const statusLike = parsedTagged.hasTaggedOutput
          ? !normalizedContent
          : isStatusLikeContent(inferredStatusText);

        // If the agent already executed "text-writing" tools, we've appended each tool output
        // as its own assistant message. Avoid emitting another large fallback message that would
        // duplicate content (and feel like overwriting in the UI).
        const displayContent = normalizedContent
          ? normalizedContent
          : statusLike
            ? (
              agentHasToolOutputsRef.current
                ? (normalizedStatus || inferredStatusText || "智能需求已完成")
                : (fallbackContent || normalizedStatus || inferredStatusText)
            )
            : (response.rawMarkdown || fallbackContent);

        if (displayContent) {
          const messageId = `${Date.now()}_${round}`;
          addMessage({
            id: messageId,
            type: "assistant",
            content: displayContent,
            plainText: sanitizeMarkdownToPlainText(displayContent),
            thinking: response.thinking,
            action: "agent",
            timestamp: new Date(),
          });

          if (pendingAgentSnapshotRef.current) {
            appliedSnapshotsRef.current.set(messageId, pendingAgentSnapshotRef.current);
            markApplied(messageId);
            pendingAgentSnapshotRef.current = null;
          }
        }

        const statusMessage =
          normalizedStatus
          || (statusLike ? inferredStatusText : "")
          || "智能需求已完成";
        setAgentStatus({ state: "success", message: statusMessage });
        return;
      }

      await executeToolCalls(response.toolCalls);
    }

    setAgentStatus({
      state: "error",
      message: "已达到最大工具调用轮次，请尝试更具体的指令。",
    });
  };

  const handleAction = async (action: ActionType) => {
    if (!inputText.trim() || !action) return;
    setApplyStatus(null);
    wordBusyRef.current = true;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputText,
      action,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    conversationManager.addUserMessage(inputText);

    const savedInput = inputText;
    setInputText("");
    setLoading(true);
    setCurrentAction(action);
    setStreamingContent("");
    setStreamingThinking("");
    setStreamingThinkingExpanded(false);
    if (action === "agent") {
      setAgentStatus({ state: "running", message: "智能需求处理中..." });
    } else if (agentStatus.state !== "idle") {
      setAgentStatus({ state: "idle" });
    }

    try {
      if (action === "agent") {
        await runAgentLoop();
      } else {
        let result: AIResponse;
        const onChunk = (chunk: string, done: boolean, isThinking?: boolean) => {
          if (done) return;
          if (!chunk) return;
          if (isThinking) {
            setStreamingThinking((prev) => prev + chunk);
          } else {
            setStreamingContent((prev) => prev + chunk);
          }
        };
        switch (action) {
          case "polish":
            result = await polishTextStream(savedInput, onChunk);
            break;
          case "translate":
            result = await translateTextStream(savedInput, onChunk);
            break;
          case "grammar":
            result = await checkGrammarStream(savedInput, onChunk);
            break;
          case "summarize":
            result = await summarizeTextStream(savedInput, onChunk);
            break;
          case "continue":
            result = await continueWritingStream(savedInput, selectedStyle, onChunk);
            break;
          case "generate":
            result = await generateContentStream(savedInput, selectedStyle, onChunk);
            break;
          default:
            throw new Error(`未知的操作: ${action}`);
        }

        const finalText = (result.rawMarkdown ?? result.content).trim();
        const finalPlainText = result.plainText || sanitizeMarkdownToPlainText(finalText);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: "assistant",
          content: finalText,
          plainText: finalPlainText,
          thinking: result.thinking || undefined,
          action,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        conversationManager.addAssistantMessage(
          finalText,
          undefined,
          result.thinking || undefined
        );
        setAgentStatus({ state: "idle" });
      }

      setStreamingContent("");
      setStreamingThinking("");
    } catch (error) {
      console.error("处理失败:", error);
      const errorText = error instanceof Error ? error.message : "处理失败，请重试";
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: errorText,
        plainText: errorText,
        action,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStreamingContent("");
      setStreamingThinking("");
      if (action === "agent") {
        setAgentStatus({ state: "error", message: errorText });
      }
    } finally {
      setLoading(false);
      setCurrentAction(null);
      wordBusyRef.current = false;
    }
  };

  const handleQuickAction = (action: ActionType) => {
    setSelectedAction(action);
    if (inputText.trim()) {
      void handleAction(action);
    }
  };

  const handleSend = () => {
    if (inputText.trim() && selectedAction) {
      void handleAction(selectedAction);
    }
  };

  const getActionIcon = (action: ActionType) => {
    switch (action) {
      case "agent":
        return <Sparkle24Regular />;
      case "polish":
        return <TextEditStyle24Regular />;
      case "translate":
        return <Translate24Regular />;
      case "grammar":
        return <TextGrammarCheckmark24Regular />;
      case "summarize":
        return <TextBulletListSquare24Regular />;
      case "continue":
        return <TextExpand24Regular />;
      case "generate":
        return <Wand24Regular />;
      default:
        return <Sparkle24Regular />;
    }
  };

  const getActionLabel = (action: ActionType) => {
    switch (action) {
      case "agent":
        return "智能需求";
      case "polish":
        return "润色";
      case "translate":
        return "翻译";
      case "grammar":
        return "语法检查";
      case "summarize":
        return "生成摘要";
      case "continue":
        return "续写内容";
      case "generate":
        return "生成内容";
      default:
        return "";
    }
  };

  const inputPlaceholder = selectedAction === "agent"
    ? "描述你的需求，AI 会自动调用工具..."
    : "输入文本或从文档中选择内容...";

  return (
    <div className={styles.container}>
      {messages.length === 0 && !streamingContent && (
        <div className={styles.welcomeSection}>
          <Text className={styles.welcomeTitle}>WriteBot 写作助手</Text>
          <Text className={styles.welcomeSubtitle}>
            选择文档中的文本，或直接描述需求开始
          </Text>
          <div className={styles.quickActions}>
            <Button
              className={styles.quickActionButton}
              appearance="subtle"
              icon={<Sparkle24Regular />}
              onClick={() => handleQuickAction("agent")}
            >
              智能需求
            </Button>
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
          <div className={styles.exampleList}>
            例如：
            <br />
            - 帮我润色选中的文本
            <br />
            - 找出文档中所有包含“销售”的段落
            <br />
            - 在文档末尾添加一段总结
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
                  <div className={mergeClasses(styles.messageBubble, styles.userBubble)}>
                    {formatOriginalTextForBubble(message.content)}
                  </div>
                </>
              ) : (
                <>
                  <Text className={styles.messageLabel}>
                    {getActionLabel(message.action || null)} · 结果
                  </Text>
                  <Card className={styles.assistantCard}>
                    {message.thinking && (
                      <div className={styles.thinkingSection}>
                        <div
                          className={styles.thinkingHeader}
                          onClick={() => toggleThinking(message.id)}
                        >
                          <Brain24Regular className={styles.thinkingIcon} />
                          <Text className={styles.thinkingLabel}>思维过程</Text>
                          {expandedThinking.has(message.id) ? (
                            <ChevronUp24Regular />
                          ) : (
                            <ChevronDown24Regular />
                          )}
                        </div>
                        {expandedThinking.has(message.id) && (
                          <div className={styles.thinkingContent}>{message.thinking}</div>
                        )}
                      </div>
                    )}
                    <div className={styles.assistantCardContent}>
                      {editingMessageIds.has(message.id) ? (
                        <Textarea
                          className={styles.markdownEditor}
                          appearance="filled-lighter"
                          value={message.content}
                          onChange={(_, data) => handleUpdateMessage(message.id, data.value)}
                        />
                      ) : (
                        <MarkdownView
                          content={message.content}
                          className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                        />
                      )}
                    </div>
                    <div className={styles.assistantActions}>
                      <Button
                        className={styles.actionButton}
                        appearance="primary"
                        size="small"
                        icon={
                          applyingMessageIds.has(message.id)
                            ? <Spinner size="tiny" />
                            : <ArrowSync24Regular />
                        }
                        onClick={() => handleApply(message)}
                        disabled={
                          !message.content.trim()
                          || appliedMessageIds.has(message.id)
                          || applyingMessageIds.has(message.id)
                        }
                      >
                        {applyingMessageIds.has(message.id) ? "应用中..." : "应用"}
                      </Button>
                      <Button
                        className={styles.actionButton}
                        appearance="secondary"
                        size="small"
                        icon={<Delete24Regular />}
                        onClick={() => handleUndoApply(message.id)}
                        disabled={!appliedSnapshotsRef.current.has(message.id)}
                      >
                        撤回
                      </Button>
                      <Button
                        className={styles.actionButton}
                        appearance="secondary"
                        size="small"
                        onClick={() => toggleEditing(message.id)}
                      >
                        {editingMessageIds.has(message.id) ? "预览" : "编辑"}
                      </Button>
                    </div>
                  </Card>
                </>
              )}
            </div>
          ))}

          {(streamingContent || streamingThinking) && (
            <div className={mergeClasses(styles.messageWrapper, styles.assistantMessageWrapper)}>
              <Text className={styles.messageLabel}>
                {getActionLabel(currentAction)} · 生成中...
              </Text>
              <Card className={styles.assistantCard}>
                {streamingThinking && (
                <div className={styles.thinkingSection}>
                    <div
                      className={styles.thinkingHeader}
                      onClick={() => setStreamingThinkingExpanded((prev) => !prev)}
                    >
                      <Brain24Regular className={styles.thinkingIcon} />
                      <Text className={styles.thinkingLabel}>思维过程</Text>
                      {streamingThinkingExpanded ? <ChevronUp24Regular /> : <ChevronDown24Regular />}
                      <Spinner size="tiny" />
                    </div>
                    {streamingThinkingExpanded && (
                      <div className={styles.thinkingContent}>{streamingThinking}</div>
                    )}
                  </div>
                )}
                <div className={styles.assistantCardContent}>
                  {streamingContent ? (
                    <MarkdownView
                      content={streamingContent}
                      className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                    />
                  ) : (
                    <div className={styles.assistantContent}>正在思考...</div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {loading && currentAction === "agent" && !streamingContent && !streamingThinking && (
            <div className={mergeClasses(styles.messageWrapper, styles.assistantMessageWrapper)}>
              <Text className={styles.messageLabel}>智能需求 · 生成中...</Text>
              <Card className={styles.assistantCard}>
                <div className={styles.assistantCardContent}>
                  <div className={styles.assistantContent}>正在思考...</div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {agentStatus.state !== "idle" && (
        <div className={styles.statusBar}>
          <Text
            className={mergeClasses(
              agentStatus.state === "success" && styles.statusSuccess,
              agentStatus.state === "error" && styles.statusError
            )}
          >
            {agentStatus.state === "running" && "⏳"}
            {agentStatus.state === "success" && "✓"}
            {agentStatus.state === "error" && "✗"} 智能需求状态：
            {agentStatus.message || (agentStatus.state === "running" ? "处理中..." : "已完成")}
          </Text>
        </div>
      )}

      {applyStatus && (
        <div className={styles.statusBar}>
          <Text
            className={mergeClasses(
              applyStatus.state === "success" && styles.statusSuccess,
              applyStatus.state === "warning" && styles.statusWarning,
              applyStatus.state === "error" && styles.statusError
            )}
          >
            {applyStatus.state === "success" && "✓"}
            {applyStatus.state === "warning" && "⚠"}
            {applyStatus.state === "error" && "✗"} 应用状态：{applyStatus.message}
          </Text>
        </div>
      )}

      <div className={styles.inputContainer}>
        <Textarea
          className={styles.textarea}
          placeholder={inputPlaceholder}
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
            {([
              "agent",
              "polish",
              "translate",
              "grammar",
              "summarize",
              "continue",
              "generate",
            ] as ActionType[]).map((action) => (
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
                  if (data.optionValue) {
                    setSelectedStyle(data.optionValue as StyleType);
                  }
                }}
                size="small"
              >
                <Option value="formal">正式</Option>
                <Option value="casual">轻松</Option>
                <Option value="professional">专业</Option>
                <Option value="creative">创意</Option>
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
