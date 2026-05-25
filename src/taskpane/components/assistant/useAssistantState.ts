import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSelectedText,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
} from "../../../utils/wordApi";
import { throttle } from "../../../utils/throttle";
import {
  clearAgentMemory,
  EDIT_TRANSACTION_LEDGER_CHANGED_EVENT,
  saveConversation,
  loadConversation,
  clearConversation,
  clearAgentPlan,
  loadEditTransactions,
  loadAgentPermissionMode,
  saveAgentPermissionMode,
  getAndClearContextMenuResult,
  getContextMenuResultKey,
  StoredMessage,
} from "../../../utils/storageService";
import { ConversationManager } from "../../../utils/conversationManager";
import { ToolExecutor } from "../../../utils/toolExecutor";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import { editTransactionService } from "../../../utils/editTransactionService";
import type { ActionType, AgentPermissionMode, Message, StyleType } from "./types";
import { getActionLabel } from "./types";
import type { ArticleOutline, MultiAgentPhase } from "./multiAgent/types";
import type { EditRollbackPreview, EditTransaction } from "../../../utils/editTransactionTypes";
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  type TranslationTargetLanguage,
} from "../../../utils/translationLanguages";
import { getFirstEnabledAssistantModuleId } from "../../../utils/assistantModuleService";

const AUTO_SCROLL_BOTTOM_THRESHOLD = 32;
const MAX_VISIBLE_MESSAGES = 80;

export interface AgentPlanViewState {
  content: string;
  currentStage: number;
  totalStages: number;
  completedStages: number[];
  updatedAt: string;
}

export interface WordDiffPreviewState {
  transactionId: string;
  toolName: "replace_selected_text" | "insert_text";
  operationTitle: string;
  summary: string;
  beforeText: string;
  afterText: string;
}

export interface ApplyStatusAction {
  label: string;
  action: () => void | Promise<void>;
}

export interface ChangeTimelineState {
  open: boolean;
  transactions: EditTransaction[];
  loading: boolean;
  selectedPreview: EditRollbackPreview | null;
  previewingTransactionId?: string;
}

export interface AssistantState {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  currentAction: ActionType;
  setCurrentAction: React.Dispatch<React.SetStateAction<ActionType>>;
  selectedStyle: StyleType;
  setSelectedStyle: React.Dispatch<React.SetStateAction<StyleType>>;
  selectedTranslationTarget: TranslationTargetLanguage;
  setSelectedTranslationTarget: React.Dispatch<React.SetStateAction<TranslationTargetLanguage>>;
  agentPermissionMode: AgentPermissionMode;
  setAgentPermissionMode: React.Dispatch<React.SetStateAction<AgentPermissionMode>>;
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
  applyStatus: {
    state: "success" | "warning" | "error" | "retrying" | "reviewing" | "writing";
    message: string;
    actions?: ApplyStatusAction[];
  } | null;
  setApplyStatus: React.Dispatch<
    React.SetStateAction<{
      state: "success" | "warning" | "error" | "retrying" | "reviewing" | "writing";
      message: string;
      actions?: ApplyStatusAction[];
    } | null>
  >;
  agentPlanView: AgentPlanViewState | null;
  setAgentPlanView: React.Dispatch<React.SetStateAction<AgentPlanViewState | null>>;
  changeTimeline: ChangeTimelineState;
  setChangeTimelineOpen: (open: boolean) => void;
  refreshChangeTimeline: () => Promise<void>;
  previewTimelineRollback: (transactionId: string) => Promise<void>;
  rollbackTimelineTransaction: (transactionId: string) => Promise<void>;
  rollbackTimelineGroup: (operationGroupId: string) => Promise<void>;
  applyingMessageIds: Set<string>;
  setApplyingMessageIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  appliedTransactionsRef: React.MutableRefObject<Map<string, AppliedUndoHandle>>;
  pendingAgentTransactionsRef: React.MutableRefObject<AppliedUndoHandle | null>;
  lastAgentOutputRef: React.MutableRefObject<string | null>;
  agentHasToolOutputsRef: React.MutableRefObject<boolean>;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  handleChatScroll: React.UIEventHandler<HTMLDivElement>;
  showScrollToBottomButton: boolean;
  handleScrollToBottom: () => void;
  wordBusyRef: React.MutableRefObject<boolean>;
  addMessage: (message: Message) => void;
  toggleThinking: (messageId: string) => void;
  toggleEditing: (messageId: string) => void;
  handleUpdateMessage: (messageId: string, newContent: string) => void;
  markApplied: (messageId: string) => void;
  unmarkApplied: (messageId: string) => void;
  handleClearChat: () => void;
  handleSelectAgentPermissionMode: (mode: AgentPermissionMode) => void;
  scrollToBottom: () => void;
  fetchSelectedText: () => Promise<void>;
  handleGetSelection: () => Promise<void>;
  requestUserConfirmation: (
    message: string,
    options?: { defaultWhenUnavailable?: boolean }
  ) => { confirmed: boolean; usedFallback: boolean };
  applyContentToDocument: (
    content: string,
    preparedTransactionId?: string
  ) => Promise<{
    status: "applied" | "cancelled";
    toolName?: "replace_selected_text" | "insert_text";
    transactionId?: string;
  }>;
  prepareApplyPreview: (content: string) => Promise<WordDiffPreviewState | null>;
  handleApply: (message: Message, overrideContent?: string, preparedTransactionId?: string) => Promise<void>;
  handleUndoApply: (messageId: string) => Promise<void>;
  // Multi-agent state
  multiAgentPhase: MultiAgentPhase;
  setMultiAgentPhase: React.Dispatch<React.SetStateAction<MultiAgentPhase>>;
  multiAgentOutline: ArticleOutline | null;
  setMultiAgentOutline: React.Dispatch<React.SetStateAction<ArticleOutline | null>>;
  outlineConfirmResolverRef: React.MutableRefObject<((confirmed: boolean) => void) | null>;
}

export interface AppliedUndoHandle {
  transactionIds: string[];
  operationGroupId?: string;
}

export function useAssistantState(): AssistantState {
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleType>("professional");
  const [selectedTranslationTarget, setSelectedTranslationTarget] = useState<TranslationTargetLanguage>(
    DEFAULT_TRANSLATION_TARGET_LANGUAGE
  );
  const [agentPermissionMode, setAgentPermissionModeState] = useState<AgentPermissionMode>(() => loadAgentPermissionMode());
  const [selectedAction, setSelectedAction] = useState<ActionType>(() => getFirstEnabledAssistantModuleId());
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = loadConversation();
    return stored.map((msg) => ({
      ...msg,
      plainText: msg.plainText || (msg.type === "assistant" ? sanitizeMarkdownToPlainText(msg.content) : undefined),
      applyContent: msg.applyContent,
      action: msg.action as ActionType,
      actionLabel: msg.actionLabel,
      timestamp: new Date(msg.timestamp),
    }));
  });
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  /** 默认折叠思维过程以节省任务窗格高度；新轮次在 useAgentLoop 中会复位为 false */
  const [streamingThinkingExpanded, setStreamingThinkingExpanded] = useState(false);
  /** 历史消息的思维过程默认折叠，由用户按需展开 */
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
    state: "success" | "warning" | "error" | "retrying" | "reviewing" | "writing";
    message: string;
    actions?: ApplyStatusAction[];
  } | null>(null);
  const [agentPlanView, setAgentPlanView] = useState<AgentPlanViewState | null>(null);
  const [changeTimeline, setChangeTimeline] = useState<ChangeTimelineState>({
    open: false,
    transactions: [],
    loading: false,
    selectedPreview: null,
  });
  const [applyingMessageIds, setApplyingMessageIds] = useState<Set<string>>(new Set());
  const appliedTransactionsRef = useRef<Map<string, AppliedUndoHandle>>(new Map());
  const pendingAgentTransactionsRef = useRef<AppliedUndoHandle | null>(null);
  const lastAgentOutputRef = useRef<string | null>(null);
  const agentHasToolOutputsRef = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  // Avoid overlapping Word.run calls (e.g. selection-change polling vs apply/snapshot).
  const wordBusyRef = useRef(false);
  // Multi-agent state
  const [multiAgentPhase, setMultiAgentPhase] = useState<MultiAgentPhase>("idle");
  const [multiAgentOutline, setMultiAgentOutline] = useState<ArticleOutline | null>(null);
  const outlineConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    if (messages.length <= MAX_VISIBLE_MESSAGES) return;

    const nextMessages = messages.slice(-MAX_VISIBLE_MESSAGES);
    const retainedIds = new Set(nextMessages.map((message) => message.id));

    setMessages(nextMessages);
    setExpandedThinking((prev) => new Set(Array.from(prev).filter((id) => retainedIds.has(id))));
    setEditingMessageIds((prev) => new Set(Array.from(prev).filter((id) => retainedIds.has(id))));
    setAppliedMessageIds((prev) => new Set(Array.from(prev).filter((id) => retainedIds.has(id))));
    setApplyingMessageIds((prev) => new Set(Array.from(prev).filter((id) => retainedIds.has(id))));

    for (const id of Array.from(appliedTransactionsRef.current.keys())) {
      if (!retainedIds.has(id)) {
        appliedTransactionsRef.current.delete(id);
      }
    }
  }, [messages]);

  useEffect(() => {
    const storedMessages: StoredMessage[] = messages.map((msg) => ({
      id: msg.id,
      type: msg.type,
      content: msg.content,
      plainText: msg.plainText,
      applyContent: msg.applyContent,
      thinking: msg.thinking,
      action: msg.action || undefined,
      actionLabel: msg.actionLabel,
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
        actionLabel: getActionLabel(pendingResult.action as ActionType),
        timestamp: new Date(pendingResult.timestamp),
      };
      const assistantMessage: Message = {
        id: pendingResult.id + "_result",
        type: "assistant",
        content: pendingResult.resultText,
        plainText: sanitizeMarkdownToPlainText(pendingResult.resultText),
        applyContent: pendingResult.resultText,
        thinking: pendingResult.thinking,
        action: pendingResult.action as ActionType,
        actionLabel: getActionLabel(pendingResult.action as ActionType),
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

  const isNearBottom = useCallback((container: HTMLDivElement) => {
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const syncAutoScrollState = useCallback((container?: HTMLDivElement | null) => {
    const target = container ?? chatContainerRef.current;
    if (!target) {
      shouldAutoScrollRef.current = true;
      setShowScrollToBottomButton(false);
      return true;
    }
    const nearBottom = isNearBottom(target);
    shouldAutoScrollRef.current = nearBottom;
    if (nearBottom) {
      setShowScrollToBottomButton(false);
    }
    return nearBottom;
  }, [isNearBottom]);

  const handleChatScroll = useCallback<React.UIEventHandler<HTMLDivElement>>((event) => {
    syncAutoScrollState(event.currentTarget);
  }, [syncAutoScrollState]);

  const scrollToBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    shouldAutoScrollRef.current = true;
  }, []);

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
    setShowScrollToBottomButton(false);
  }, [scrollToBottom]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
      setShowScrollToBottomButton(false);
      return;
    }
    const nearBottom = syncAutoScrollState();
    if (!nearBottom) {
      setShowScrollToBottomButton(true);
    }
  }, [messages.length, streamingContent, streamingThinking, scrollToBottom, syncAutoScrollState]);

  const fetchSelectedText = useCallback(async () => {
    try {
      if (wordBusyRef.current) return;
      const text = await getSelectedText();
      setInputText(text);
    } catch (error) {
      console.error("获取选中文本失败:", error);
    }
  }, []);

  const throttledFetchSelectedTextRef = useRef(
    throttle(() => {
      void fetchSelectedText();
    }, 300)
  );

  // Keep the throttled function in sync when fetchSelectedText changes
  useEffect(() => {
    throttledFetchSelectedTextRef.current.cancel();
    throttledFetchSelectedTextRef.current = throttle(() => {
      void fetchSelectedText();
    }, 300);
  }, [fetchSelectedText]);

  useEffect(() => {
    fetchSelectedText();

    const handler = () => {
      throttledFetchSelectedTextRef.current();
    };

    addSelectionChangedHandler(handler).catch((error) => {
      console.error("添加选择变化监听器失败:", error);
    });

    return () => {
      throttledFetchSelectedTextRef.current.cancel();
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

  function requestUserConfirmation(
    message: string,
    options?: { defaultWhenUnavailable?: boolean }
  ): { confirmed: boolean; usedFallback: boolean } {
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
  }

  const refreshChangeTimeline = useCallback(async () => {
    setChangeTimeline((prev) => ({ ...prev, loading: true }));
    try {
      const transactions = await loadEditTransactions();
      setChangeTimeline((prev) => ({
        ...prev,
        transactions,
        loading: false,
      }));
    } catch (error) {
      console.error("加载变更时间线失败:", error);
      setChangeTimeline((prev) => ({ ...prev, loading: false }));
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "加载变更时间线失败",
        actions: undefined,
      });
    }
  }, []);

  useEffect(() => {
    void refreshChangeTimeline();
    const handleLedgerChanged = () => {
      void refreshChangeTimeline();
    };
    window.addEventListener(EDIT_TRANSACTION_LEDGER_CHANGED_EVENT, handleLedgerChanged);
    return () => {
      window.removeEventListener(EDIT_TRANSACTION_LEDGER_CHANGED_EVENT, handleLedgerChanged);
    };
  }, [refreshChangeTimeline]);

  const setChangeTimelineOpen = useCallback((open: boolean) => {
    setChangeTimeline((prev) => ({ ...prev, open }));
    if (open) {
      void refreshChangeTimeline();
    }
  }, [refreshChangeTimeline]);

  const previewTimelineRollback = useCallback(async (transactionId: string) => {
    setChangeTimeline((prev) => ({ ...prev, previewingTransactionId: transactionId }));
    try {
      const preview = await editTransactionService.previewRollback(transactionId);
      setChangeTimeline((prev) => ({
        ...prev,
        selectedPreview: preview,
        previewingTransactionId: undefined,
      }));
      if (!preview.canRollback) {
        setApplyStatus({
          state: "warning",
          message: preview.blockedReason || "撤回预览显示当前内容无法安全撤回。",
          actions: undefined,
        });
      }
    } catch (error) {
      setChangeTimeline((prev) => ({ ...prev, previewingTransactionId: undefined }));
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "生成撤回预览失败",
        actions: undefined,
      });
    }
  }, []);

  const rollbackTimelineTransaction = useCallback(async (transactionId: string) => {
    try {
      const preview = await editTransactionService.previewRollback(transactionId);
      setChangeTimeline((prev) => ({ ...prev, selectedPreview: preview }));
      if (!preview.canRollback) {
        setApplyStatus({
          state: "warning",
          message: preview.blockedReason || "当前内容无法安全撤回。",
          actions: undefined,
        });
        return;
      }
      const { confirmed } = requestUserConfirmation(
        [
          "即将撤回一项已提交变更。",
          "",
          `目标：${preview.targetDescription}`,
          `当前内容：${preview.currentText || "（空）"}`,
          `将恢复为：${preview.restoreText || "（空）"}`,
          "",
          "是否继续？",
        ].join("\n"),
        { defaultWhenUnavailable: false }
      );
      if (!confirmed) return;
      await editTransactionService.rollbackEdit(transactionId);
      await refreshChangeTimeline();
      setApplyStatus({
        state: "success",
        message: "已撤回该事务，并写入撤回审计记录。",
        actions: undefined,
      });
    } catch (error) {
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "撤回失败",
        actions: undefined,
      });
    }
  }, [refreshChangeTimeline]);

  const rollbackTimelineGroup = useCallback(async (operationGroupId: string) => {
    const { confirmed } = requestUserConfirmation(
      `将按逆序撤回操作组 ${operationGroupId} 中所有可撤回事务，是否继续？`,
      { defaultWhenUnavailable: false }
    );
    if (!confirmed) return;
    try {
      const rolledBack = await editTransactionService.rollbackEditGroup(operationGroupId);
      await refreshChangeTimeline();
      setApplyStatus({
        state: "success",
        message: `已撤回操作组中的 ${rolledBack.length} 项事务。`,
        actions: undefined,
      });
    } catch (error) {
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "成组撤回失败",
        actions: undefined,
      });
    }
  }, [refreshChangeTimeline]);

  const unmarkApplied = (messageId: string) => {
    setAppliedMessageIds((prev) => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  };

  const buildManualApplyPlan = async (content: string) => {
    const selectedText = await getSelectedText();
    const hasSelection = selectedText.trim().length > 0;

    if (hasSelection) {
      return {
        toolName: "replace_selected_text" as const,
        transaction: editTransactionService.planEdit({
          source: "manual_apply",
          operationGroupId: `manual_${Date.now().toString(36)}`,
          operation: {
            type: "replace_selection",
            content,
            contentFormat: "markdown",
            preserveSelectionFormat: true,
          },
          scope: { kind: "selection" },
          expectedBefore: {
            expectedTextExcerpt: selectedText,
          },
        }),
      };
    }

    return {
      toolName: "insert_text" as const,
      transaction: editTransactionService.planEdit({
        source: "manual_apply",
        operationGroupId: `manual_${Date.now().toString(36)}`,
        operation: {
          type: "insert_text",
          content,
          contentFormat: "markdown",
        },
        scope: { kind: "cursor", location: "cursor" },
      }),
    };
  };

  const prepareApplyPreview = async (content: string): Promise<WordDiffPreviewState | null> => {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const { transaction, toolName } = await buildManualApplyPlan(trimmed);
    const previewed = await editTransactionService.previewDiff(transaction);
    return {
      transactionId: previewed.id,
      toolName,
      operationTitle: previewed.preview?.title || previewed.operation.type,
      summary: previewed.preview?.summary || "",
      beforeText: previewed.preview?.beforeText || "",
      afterText: previewed.preview?.afterText || "",
    };
  };

  const applyContentToDocument = async (
    content: string,
    preparedTransactionId?: string
  ): Promise<{
    status: "applied" | "cancelled";
    toolName?: "replace_selected_text" | "insert_text";
    transactionId?: string;
  }> => {
    const selectedText = await getSelectedText();
    const hasSelection = selectedText.trim().length > 0;

    if (preparedTransactionId) {
      const verified = await editTransactionService.executeTransactionById(preparedTransactionId);
      return {
        status: "applied",
        toolName: verified.operation.type === "replace_selection" ? "replace_selected_text" : "insert_text",
        transactionId: verified.id,
      };
    }

    // Align manual apply with agent auto-apply behavior:
    // - has selection: same as replace_selected_text (preserve style, no Markdown re-render)
    // - no selection: same as insert_text at cursor
    if (hasSelection) {
      const { transaction } = await buildManualApplyPlan(content);
      const planned = transaction;
      const previewed = await editTransactionService.previewDiff(planned);
      const validated = await editTransactionService.validateTarget(previewed);
      const captured = await editTransactionService.captureBefore(validated);
      const committed = await editTransactionService.commitEdit(captured);
      const verified = await editTransactionService.verifyAfter(committed);
      return {
        status: "applied",
        toolName: "replace_selected_text",
        transactionId: verified.id,
      };
    }

    const { confirmed } = requestUserConfirmation("未检测到选中文本，将在光标位置插入内容，是否继续？", {
      defaultWhenUnavailable: true,
    });
    if (!confirmed) {
      return { status: "cancelled" };
    }

    const { transaction: planned } = await buildManualApplyPlan(content);
    const previewed = await editTransactionService.previewDiff(planned);
    const validated = await editTransactionService.validateTarget(previewed);
    const captured = await editTransactionService.captureBefore(validated);
    const committed = await editTransactionService.commitEdit(captured);
    const verified = await editTransactionService.verifyAfter(committed);
    return {
      status: "applied",
      toolName: "insert_text",
      transactionId: verified.id,
    };
  };

  const handleApply = async (message: Message, overrideContent?: string, preparedTransactionId?: string) => {
    const latestMessage = messages.find((msg) => msg.id === message.id);
    const content = overrideContent ?? latestMessage?.applyContent ?? latestMessage?.content ?? message.content;
    if (!content.trim()) return;
    if (appliedMessageIds.has(message.id) || applyingMessageIds.has(message.id)) return;
    setApplyStatus(null);
    setApplyingMessageIds((prev) => {
      const next = new Set(prev);
      next.add(message.id);
      return next;
    });
    wordBusyRef.current = true;
    try {
      const result = await applyContentToDocument(content, preparedTransactionId);
      if (result.status === "cancelled") return;

      const appliedToolName = result.toolName || "insert_text";
      const appliedToolLabelMap: Record<"insert_text" | "replace_selected_text", string> = {
        insert_text: "插入文本",
        replace_selected_text: "替换选中文本",
      };
      const appliedToolLabel = `${appliedToolLabelMap[appliedToolName]}（${appliedToolName}）`;

      if (!result.transactionId) {
        throw new Error("写入成功但未返回 transactionId");
      }
      appliedTransactionsRef.current.set(message.id, {
        transactionIds: [result.transactionId],
      });
      setApplyStatus({
        state: "success",
        message: `已执行：${appliedToolLabel}`,
        actions: undefined,
      });
      markApplied(message.id);
    } catch (error) {
      console.error("应用失败:", error);
      const errorMessage = error instanceof Error ? error.message : "应用失败，请重试。";
      let actions: ApplyStatusAction[] | undefined;
      const transactionIdMatch = errorMessage.match(/tx_[0-9a-z_]+/i);
      const rawTransactionId = transactionIdMatch?.[0];
      if (rawTransactionId) {
        try {
          const inspection = await editTransactionService.inspectUnknownCommitState(rawTransactionId);
          if (inspection.status === "already_committed") {
            appliedTransactionsRef.current.set(message.id, { transactionIds: [rawTransactionId] });
            markApplied(message.id);
            setApplyStatus({
              state: "success",
              message: inspection.message,
              actions: undefined,
            });
            return;
          }
        } catch (inspectionError) {
          console.warn("事务自动校验失败，保留原始错误提示:", inspectionError);
        }
      }
      if (rawTransactionId || errorMessage.includes("unknown_commit_state") || errorMessage.includes("提交失败")) {
        const candidateId = rawTransactionId;
        if (candidateId) {
          actions = [{
            label: "检查并重提",
            action: async () => {
              try {
                const inspection = await editTransactionService.inspectUnknownCommitState(candidateId);
                if (inspection.status === "already_committed") {
                  appliedTransactionsRef.current.set(message.id, { transactionIds: [candidateId] });
                  markApplied(message.id);
                  setApplyStatus({
                    state: "success",
                    message: inspection.message,
                    actions: undefined,
                  });
                  return;
                }
                if (inspection.status === "definitely_not_committed") {
                  const { confirmed } = requestUserConfirmation(
                    "已确认该事务尚未写入。是否立即重新提交？",
                    { defaultWhenUnavailable: false }
                  );
                  if (!confirmed) {
                    setApplyStatus({
                      state: "warning",
                      message: inspection.message,
                      actions: undefined,
                    });
                    return;
                  }
                  const retried = await editTransactionService.retryUnknownCommit(candidateId);
                  appliedTransactionsRef.current.set(message.id, { transactionIds: [retried.id] });
                  markApplied(message.id);
                  setApplyStatus({
                    state: "success",
                    message: "事务已重新提交并验证成功。",
                    actions: undefined,
                  });
                  return;
                }
                setApplyStatus({
                  state: "error",
                  message: inspection.message,
                  actions: undefined,
                });
              } catch (resolveError) {
                setApplyStatus({
                  state: "error",
                  message: resolveError instanceof Error ? resolveError.message : "事务检查失败",
                  actions: undefined,
                });
              }
            },
          }];
        }
      }
      setApplyStatus({
        state: "error",
        message: errorMessage,
        actions,
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
    const undoHandle = appliedTransactionsRef.current.get(messageId);
    if (!undoHandle) {
      setApplyStatus({
        state: "warning",
        message: "未找到撤回快照，无法撤回该内容。",
        actions: undefined,
      });
      return;
    }
    try {
      const rollbackIds = undoHandle.transactionIds.slice().reverse();
      for (const transactionId of rollbackIds) {
        const preview = await editTransactionService.previewRollback(transactionId);
        if (!preview.canRollback) {
          throw new Error(preview.blockedReason || "当前内容无法安全撤回");
        }
        const { confirmed } = requestUserConfirmation(
          [
            "即将撤回该消息关联的事务。",
            "",
            `目标：${preview.targetDescription}`,
            `当前内容：${preview.currentText || "（空）"}`,
            `将恢复为：${preview.restoreText || "（空）"}`,
            "",
            "是否继续？",
          ].join("\n"),
          { defaultWhenUnavailable: false }
        );
        if (!confirmed) return;
        await editTransactionService.rollbackEdit(transactionId);
      }
      const entries = Array.from(appliedTransactionsRef.current.entries());
      for (const [id, handle] of entries) {
        if (handle === undoHandle) {
          appliedTransactionsRef.current.delete(id);
          unmarkApplied(id);
        }
      }
      await refreshChangeTimeline();
      setApplyStatus({
        state: "success",
        message: "已撤回该消息关联的变更，并写入撤回审计记录。",
        actions: undefined,
      });
    } catch (error) {
      console.error("撤回失败:", error);
      setApplyStatus({
        state: "error",
        message: error instanceof Error ? error.message : "撤回失败，请重试。",
        actions: undefined,
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
    setAgentPlanView(null);
    setChangeTimeline({
      open: false,
      transactions: [],
      loading: false,
      selectedPreview: null,
    });
    setAgentStatus({ state: "idle" });
    setMultiAgentPhase("idle");
    setMultiAgentOutline(null);
    outlineConfirmResolverRef.current = null;
    appliedTransactionsRef.current.clear();
    pendingAgentTransactionsRef.current = null;
    lastAgentOutputRef.current = null;
    clearConversation();
    clearAgentPlan();
    clearAgentMemory();
    conversationManager.clear();
  };

  const setAgentPermissionMode = (modeOrUpdater: React.SetStateAction<AgentPermissionMode>) => {
    setAgentPermissionModeState((prev) => {
      const next = typeof modeOrUpdater === "function"
        ? (modeOrUpdater as (value: AgentPermissionMode) => AgentPermissionMode)(prev)
        : modeOrUpdater;
      saveAgentPermissionMode(next);
      return next;
    });
  };

  const handleSelectAgentPermissionMode = (mode: AgentPermissionMode) => {
    if (mode === agentPermissionMode) return;
    if (mode === "full_access") {
      const { confirmed } = requestUserConfirmation(
        [
          "切换到完全访问权限后，AI 工具调用将不再逐次请求确认。",
          "",
          "这包括插入、替换、追加、批注、格式修改和恢复快照等操作。",
          "请只在你信任当前任务、模型配置和文档上下文时使用。",
          "",
          "是否切换到完全访问权限？",
        ].join("\n"),
        { defaultWhenUnavailable: false }
      );
      if (!confirmed) return;
    }

    setAgentPermissionMode(mode);
    const statusText: Record<AgentPermissionMode, string> = {
      default: "已切换为默认权限：写入和高风险工具会请求确认。",
      auto_review: "已切换为自动审查：自动批准建议/写入工具，高风险工具仍会请求确认。",
      full_access: "已切换为完全访问权限：将自动批准所有工具调用。",
    };
    setApplyStatus({
      state: mode === "default" ? "success" : "warning",
      message: statusText[mode],
      actions: undefined,
    });
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
    selectedTranslationTarget,
    setSelectedTranslationTarget,
    agentPermissionMode,
    setAgentPermissionMode,
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
    agentPlanView,
    setAgentPlanView,
    changeTimeline,
    setChangeTimelineOpen,
    refreshChangeTimeline,
    previewTimelineRollback,
    rollbackTimelineTransaction,
    rollbackTimelineGroup,
    applyingMessageIds,
    setApplyingMessageIds,
    appliedTransactionsRef,
    pendingAgentTransactionsRef,
    lastAgentOutputRef,
    agentHasToolOutputsRef,
    chatContainerRef,
    handleChatScroll,
    showScrollToBottomButton,
    handleScrollToBottom,
    wordBusyRef,
    addMessage,
    toggleThinking,
    toggleEditing,
    handleUpdateMessage,
    markApplied,
    unmarkApplied,
    handleClearChat,
    handleSelectAgentPermissionMode,
    scrollToBottom,
    fetchSelectedText,
    handleGetSelection,
    requestUserConfirmation,
    applyContentToDocument,
    prepareApplyPreview,
    handleApply,
    handleUndoApply,
    multiAgentPhase,
    setMultiAgentPhase,
    multiAgentOutline,
    setMultiAgentOutline,
    outlineConfirmResolverRef,
  };
}
