import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSelectedText,
  getDocumentBodyOoxml,
  restoreDocumentOoxml,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
  DocumentSnapshot,
} from "../../../utils/wordApi";
import {
  saveConversation,
  loadConversation,
  clearConversation,
  getAndClearContextMenuResult,
  getContextMenuResultKey,
  StoredMessage,
} from "../../../utils/storageService";
import { ConversationManager } from "../../../utils/conversationManager";
import { ToolExecutor } from "../../../utils/toolExecutor";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import { applyAiContentToWord, insertAiContentToWord } from "../../../utils/wordContentApplier";
import type { ActionType, Message, StyleType } from "./types";

export interface AssistantState {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  currentAction: ActionType;
  setCurrentAction: React.Dispatch<React.SetStateAction<ActionType>>;
  selectedStyle: StyleType;
  setSelectedStyle: React.Dispatch<React.SetStateAction<StyleType>>;
  selectedAction: ActionType;
  setSelectedAction: React.Dispatch<React.SetStateAction<ActionType>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  streamingContent: string;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  streamingThinking: string;
  setStreamingThinking: React.Dispatch<React.SetStateAction<string>>;
  streamingThinkingExpanded: boolean;
  setStreamingThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  expandedThinking: Set<string>;
  editingMessageIds: Set<string>;
  conversationManager: ConversationManager;
  toolExecutor: ToolExecutor;
  appliedMessageIds: Set<string>;
  agentStatus: { state: "idle" | "running" | "success" | "error"; message?: string };
  setAgentStatus: React.Dispatch<
    React.SetStateAction<{ state: "idle" | "running" | "success" | "error"; message?: string }>
  >;
  applyStatus: { state: "success" | "warning" | "error"; message: string } | null;
  setApplyStatus: React.Dispatch<
    React.SetStateAction<{ state: "success" | "warning" | "error"; message: string } | null>
  >;
  applyingMessageIds: Set<string>;
  setApplyingMessageIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  appliedSnapshotsRef: React.MutableRefObject<Map<string, DocumentSnapshot>>;
  pendingAgentSnapshotRef: React.MutableRefObject<DocumentSnapshot | null>;
  lastAgentOutputRef: React.MutableRefObject<string | null>;
  agentHasToolOutputsRef: React.MutableRefObject<boolean>;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  wordBusyRef: React.MutableRefObject<boolean>;
  addMessage: (message: Message) => void;
  toggleThinking: (messageId: string) => void;
  toggleEditing: (messageId: string) => void;
  handleUpdateMessage: (messageId: string, newContent: string) => void;
  markApplied: (messageId: string) => void;
  unmarkApplied: (messageId: string) => void;
  handleClearChat: () => void;
  scrollToBottom: () => void;
  fetchSelectedText: () => Promise<void>;
  handleGetSelection: () => Promise<void>;
  requestUserConfirmation: (
    message: string,
    options?: { defaultWhenUnavailable?: boolean }
  ) => { confirmed: boolean; usedFallback: boolean };
  applyContentToDocument: (
    content: string
  ) => Promise<{
    status: "applied" | "cancelled";
    toolName?: "replace_selected_text" | "insert_text";
  }>;
  handleApply: (message: Message) => Promise<void>;
  handleUndoApply: (messageId: string) => Promise<void>;
}

export function useAssistantState(): AssistantState {
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

  return {
    inputText,
    setInputText,
    loading,
    setLoading,
    currentAction,
    setCurrentAction,
    selectedStyle,
    setSelectedStyle,
    selectedAction,
    setSelectedAction,
    messages,
    setMessages,
    streamingContent,
    setStreamingContent,
    streamingThinking,
    setStreamingThinking,
    streamingThinkingExpanded,
    setStreamingThinkingExpanded,
    expandedThinking,
    editingMessageIds,
    conversationManager,
    toolExecutor,
    appliedMessageIds,
    agentStatus,
    setAgentStatus,
    applyStatus,
    setApplyStatus,
    applyingMessageIds,
    setApplyingMessageIds,
    appliedSnapshotsRef,
    pendingAgentSnapshotRef,
    lastAgentOutputRef,
    agentHasToolOutputsRef,
    chatContainerRef,
    wordBusyRef,
    addMessage,
    toggleThinking,
    toggleEditing,
    handleUpdateMessage,
    markApplied,
    unmarkApplied,
    handleClearChat,
    scrollToBottom,
    fetchSelectedText,
    handleGetSelection,
    requestUserConfirmation,
    applyContentToDocument,
    handleApply,
    handleUndoApply,
  };
}
