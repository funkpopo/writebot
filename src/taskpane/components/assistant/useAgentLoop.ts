import { useRef, startTransition } from "react";
import {
  type AIResponse,
} from "../../../utils/aiService";
import type { ToolCallRequest, ToolCallResult } from "../../../types/tools";
import {
  getAssistantModuleById,
} from "../../../utils/assistantModuleService";
import { runAssistantSimpleModule } from "../../../utils/assistantModuleRuntime";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import { clearAgentCheckpoint } from "../../../utils/storageService";
import type { ActionType, Message } from "./types";
import type { StageWriteGuardContext } from "./stageWriteGuard";
import { runAgentToolCalls } from "./agentToolRunner";
import {
  buildEtaProgressLabel,
  loadPipelineMetricsHistory,
} from "./multiAgent/pipelineMetrics";
import type { ArticleOutline, MultiAgentPhase } from "./multiAgent/types";
import type { AgentPlanViewState, ApplyStatusAction, AssistantState } from "./useAssistantState";

export function useAgentLoop(state: AssistantState) {
  const {
    setStreamingContent,
    setStreamingThinking,
    setStreamingThinkingExpanded,
    setLoading,
    setCurrentAction,
    setAgentStatus,
    setApplyStatus,
    setAgentPlanView,
    setMessages,
    setInputText,
    selectedStyle,
    selectedTranslationTarget,
    agentPermissionMode,
    agentStatus,
    conversationManager,
    toolExecutor,
    appliedTransactionsRef,
    pendingAgentTransactionsRef,
    wordBusyRef,
    addMessage,
    markApplied,
    requestUserConfirmation,
    inputText,
    setMultiAgentPhase,
    setMultiAgentOutline,
    outlineConfirmResolverRef,
  } = state;
  const stopRequestedRef = useRef(false);
  const activeRunIdRef = useRef(0);
  const currentSectionTitleRef = useRef<string | undefined>(undefined);

  const createStreamingBatcher = (
    setter: (updater: (prev: string) => string) => void
  ) => {
    let pending = "";
    let timer: number | null = null;

    const flush = () => {
      timer = null;
      if (!pending) return;
      const chunk = pending;
      pending = "";
      setter((prev) => prev + chunk);
    };

    const push = (chunk: string) => {
      if (!chunk) return;
      pending += chunk;
      if (timer !== null) return;
      timer = window.setTimeout(flush, 50);
    };

    const cancel = () => {
      pending = "";
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    return { push, flush, cancel };
  };

  const beginRun = (): number => {
    stopRequestedRef.current = false;
    activeRunIdRef.current += 1;
    return activeRunIdRef.current;
  };

  const isRunCancelled = (runId: number): boolean => {
    return stopRequestedRef.current || activeRunIdRef.current !== runId;
  };

  const extractSectionProgressFromMessage = (
    message?: string
  ): { current: number; total: number } | null => {
    if (!message) return null;
    const match = message.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return null;
    const current = Number.parseInt(match[1], 10);
    const total = Number.parseInt(match[2], 10);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
      return null;
    }
    return {
      current: Math.min(Math.max(0, current), total),
      total: Math.max(1, total),
    };
  };

  const toPlanMarkdownFromOutline = (outline: ArticleOutline): string => {
    const lines = ["## 阶段计划"];
    for (let index = 0; index < outline.sections.length; index += 1) {
      lines.push(`${index + 1}. ${outline.sections[index].title}`);
    }
    return lines.join("\n");
  };

  const withPlanProgressMeta = (
    base: Pick<AgentPlanViewState, "content" | "currentStage" | "totalStages" | "completedStages"> & {
      currentSectionTitle?: string;
    },
    phase: MultiAgentPhase,
  ): AgentPlanViewState => {
    const completedCount = Math.max(
      base.completedStages.length,
      Math.max(0, base.currentStage - (phase === "writing" || phase === "revising" ? 1 : 0)),
    );
    const eta = buildEtaProgressLabel({
      history: loadPipelineMetricsHistory(),
      completedSections: completedCount,
      totalSections: Math.max(1, base.totalStages),
      phase,
      currentSectionTitle: base.currentSectionTitle,
    });
    return {
      content: base.content,
      currentStage: base.currentStage,
      totalStages: base.totalStages,
      completedStages: base.completedStages,
      currentSectionTitle: base.currentSectionTitle || eta.sectionLabel?.replace(/^正(?:写|修订)：/, "") || undefined,
      etaLabel: eta.etaLabel || undefined,
      updatedAt: new Date().toISOString(),
    };
  };

  const handleActionRef = useRef<(action: ActionType, inputOverride?: string) => Promise<void>>(
    async () => undefined,
  );

  const buildWorkflowRecoveryActions = (
    action: ActionType,
    savedInput: string,
  ): ApplyStatusAction[] => {
    const retryCurrent = () => {
      // 保留 checkpoint，由 orchestrator 从失败节点恢复（重试本章/当前节点）。
      setAgentStatus({ state: "running", message: "正在重试..." });
      void handleActionRef.current(action, savedInput);
    };
    const skipReviewComplete = async () => {
      try {
        await clearAgentCheckpoint();
      } catch {
        // ignore storage errors; still mark complete for UX
      }
      setAgentStatus({
        state: "success",
        message: "已跳过审阅，以当前文档内容完成",
      });
      setMultiAgentPhase("completed");
      addMessage({
        id: `${Date.now().toString(36)}_skip_review`,
        type: "assistant",
        content: "已跳过审阅完成。请检查 Word 中已写入的内容，可按需手动修改。",
        plainText: "已跳过审阅完成。请检查 Word 中已写入的内容，可按需手动修改。",
        action,
        uiOnly: true,
        timestamp: new Date(),
      });
    };
    const restartFromOutline = async () => {
      try {
        await clearAgentCheckpoint();
      } catch {
        // ignore
      }
      setAgentStatus({ state: "running", message: "正在从大纲重新开始..." });
      void handleActionRef.current(action, savedInput);
    };
    return [
      { label: "重试本章", action: retryCurrent },
      { label: "跳过审阅完成", action: () => { void skipReviewComplete(); } },
      { label: "从大纲重来", action: () => { void restartFromOutline(); } },
    ];
  };

  const appendPendingAgentTransaction = (transactionId: string, operationGroupId?: string) => {
    const currentHandle = pendingAgentTransactionsRef.current;
    if (!currentHandle) {
      pendingAgentTransactionsRef.current = {
        transactionIds: [transactionId],
        operationGroupId,
      };
      return;
    }
    if (!currentHandle.transactionIds.includes(transactionId)) {
      currentHandle.transactionIds.push(transactionId);
    }
    if (operationGroupId) {
      currentHandle.operationGroupId = operationGroupId;
    }
  };

  const executeToolCalls = (
    toolCalls: ToolCallRequest[],
    action: string,
    runId: number,
    userInput: string,
    writtenSegments?: string[],
    stageWriteGuard?: StageWriteGuardContext
  ): Promise<ToolCallResult[]> => runAgentToolCalls(
    toolCalls,
    action,
    runId,
    userInput,
    writtenSegments,
    stageWriteGuard,
    {
      agentPermissionMode,
      appendPendingAgentTransaction,
      conversationManager,
      isRunCancelled,
      requestUserConfirmation,
      setApplyStatus,
      toolExecutor,
    }
  );

  const handleAction = async (action: ActionType, inputOverride?: string) => {
    const requestInput = inputOverride ?? inputText;
    if (!requestInput.trim() || !action) return;
    const runId = beginRun();
    const moduleDef = getAssistantModuleById(action);
    if (!moduleDef) {
      const errorText = `未知操作: ${action}`;
      console.error(errorText);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: errorText,
        plainText: errorText,
        action: null,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }
    setApplyStatus(null);
    pendingAgentTransactionsRef.current = null;
    if (moduleDef.kind === "workflow") {
      setAgentPlanView(null);
      setAgentStatus({ state: "idle" });
      currentSectionTitleRef.current = undefined;
    }
    wordBusyRef.current = true;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: requestInput,
      action,
      actionLabel: moduleDef.label,
      timestamp: new Date(),
    };
    const priorContextMessages = conversationManager.getMessages();
    setMessages((prev) => [...prev, userMessage]);
    conversationManager.addUserMessage(requestInput);

    const savedInput = requestInput;
    setInputText("");
    setLoading(true);
    setCurrentAction(action);
    setStreamingContent("");
    setStreamingThinking("");
    setStreamingThinkingExpanded(false);
    if (moduleDef.kind !== "workflow" && agentStatus.state !== "idle") {
      setAgentStatus({ state: "idle" });
    }

    try {
      if (moduleDef.kind === "workflow") {
        // ── Multi-Agent Pipeline ──
        const { runMultiAgentPipeline } = await import("./multiAgent/orchestrator");
        const thinkingBatcher = createStreamingBatcher(setStreamingThinking);
        setAgentStatus({ state: "running", message: "正在分析需求并生成文章大纲..." });
        setMultiAgentPhase("planning");

        try {
          await runMultiAgentPipeline(savedInput, {
          onPhaseChange: (phase: MultiAgentPhase, message?: string) => {
            if (isRunCancelled(runId)) return;
            startTransition(() => {
              setMultiAgentPhase(phase);
              if (phase === "completed") {
                currentSectionTitleRef.current = undefined;
                setAgentStatus({ state: "success", message: message || "文章撰写完成" });
                setAgentPlanView((prev) => {
                  if (!prev) return prev;
                  return withPlanProgressMeta({
                    content: prev.content,
                    currentStage: prev.totalStages,
                    totalStages: prev.totalStages,
                    completedStages: prev.completedStages,
                    currentSectionTitle: undefined,
                  }, phase);
                });
              } else if (phase === "error") {
                setAgentStatus({
                  state: "error",
                  message: message || "执行失败",
                  actions: buildWorkflowRecoveryActions(action, savedInput),
                });
              } else if (phase === "idle") {
                setAgentStatus({ state: "idle", message });
              } else {
                setAgentStatus({ state: "running", message });
              }

              const progress = extractSectionProgressFromMessage(message);
              if (progress && (phase === "writing" || phase === "revising" || phase === "reviewing")) {
                setAgentPlanView((prev) => {
                  const sameTotal = prev?.totalStages === progress.total;
                  const nextCurrent = sameTotal
                    ? Math.max(prev?.currentStage || 0, progress.current)
                    : progress.current;
                  const nextCompleted = sameTotal ? (prev?.completedStages || []) : [];
                  const nextContent = prev?.content || "";
                  const sectionTitle = currentSectionTitleRef.current || prev?.currentSectionTitle;
                  return withPlanProgressMeta({
                    content: nextContent,
                    currentStage: nextCurrent,
                    totalStages: progress.total,
                    completedStages: nextCompleted,
                    currentSectionTitle: sectionTitle,
                  }, phase);
                });
              } else if (phase === "reviewing" || phase === "planning") {
                setAgentPlanView((prev) => {
                  if (!prev) return prev;
                  return withPlanProgressMeta({
                    content: prev.content,
                    currentStage: prev.currentStage,
                    totalStages: prev.totalStages,
                    completedStages: prev.completedStages,
                    currentSectionTitle: phase === "reviewing" ? undefined : prev.currentSectionTitle,
                  }, phase);
                });
              }
            });
          },
          onOutlineReady: (outline) => {
            return new Promise<boolean>((resolve) => {
              if (isRunCancelled(runId)) { resolve(false); return; }
              startTransition(() => {
                setAgentPlanView(withPlanProgressMeta({
                  content: toPlanMarkdownFromOutline(outline),
                  currentStage: 0,
                  totalStages: Math.max(1, outline.sections.length),
                  completedStages: [],
                }, "awaiting_confirmation"));
                setMultiAgentOutline(outline);
                setMultiAgentPhase("awaiting_confirmation");
              });
              outlineConfirmResolverRef.current = resolve;
            });
          },
          onSectionStart: (sectionIndex, total, title) => {
            if (isRunCancelled(runId)) return;
            currentSectionTitleRef.current = title;
            startTransition(() => {
              setAgentPlanView((prev) => {
                const currentStage = Math.max(sectionIndex + 1, prev?.currentStage || 0);
                const completedStages = prev?.completedStages || [];
                const content = prev?.content || "";
                return withPlanProgressMeta({
                  content,
                  currentStage,
                  totalStages: total,
                  completedStages,
                  currentSectionTitle: title,
                }, "writing");
              });
            });
          },
          onSectionDone: (sectionIndex, total, _title) => {
            if (isRunCancelled(runId)) return;
            startTransition(() => {
              setAgentPlanView((prev) => {
                const completedSet = new Set(prev?.completedStages || []);
                completedSet.add(sectionIndex + 1);
                const completedStages = Array.from(completedSet).sort((a, b) => a - b);
                const currentStage = Math.max(sectionIndex + 1, prev?.currentStage || 0);
                return withPlanProgressMeta({
                  content: prev?.content || "",
                  currentStage,
                  totalStages: total,
                  completedStages,
                  currentSectionTitle: currentSectionTitleRef.current,
                }, "writing");
              });
            });
          },
          onChunk: (chunk, done, isThinking) => {
            if (isRunCancelled(runId)) return;
            if (done) {
              thinkingBatcher.flush();
              return;
            }
            if (!chunk) return;
            if (isThinking) {
              thinkingBatcher.push(chunk);
            }
          },
          onToolCalls: () => {},
          executeToolCalls: async (toolCalls, writtenSegments) => {
            if (isRunCancelled(runId)) return [];
            return executeToolCalls(toolCalls, action, runId, savedInput, writtenSegments);
          },
          isRunCancelled: () => isRunCancelled(runId),
          addChatMessage: (content, options) => {
            if (isRunCancelled(runId)) return;
            addMessage({
              id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              type: "assistant",
              content,
              plainText: sanitizeMarkdownToPlainText(content),
              // uiOnly 状态消息不提供 applyContent，避免大段 Markdown 原文被当可写回草稿
              applyContent: options?.uiOnly === false ? content : undefined,
              thinking: options?.thinking,
              action,
              actionLabel: moduleDef.label,
              uiOnly: options?.uiOnly ?? true,
              timestamp: new Date(),
            });
          },
          onDocumentSnapshot: (text, label) => {
            if (isRunCancelled(runId)) return;
            const trimmed = text.trim();
            if (!trimmed) return;
            // 正式阶段大文本已写入 Word，聊天仅保留短状态，避免 Markdown 原文刷屏
            const charCount = trimmed.length;
            const statusText = `${label || "正文"}已写入 Word 文档（约 ${charCount} 字），请在文档中查看完整内容。`;
            const msgId = `${Date.now().toString(36)}_snap_${Math.random().toString(36).slice(2, 6)}`;
            addMessage({
              id: msgId,
              type: "assistant",
              content: statusText,
              plainText: statusText,
              action,
              actionLabel: moduleDef.label,
              uiOnly: true,
              timestamp: new Date(),
            });
            markApplied(msgId);
            if (pendingAgentTransactionsRef.current) {
              appliedTransactionsRef.current.set(msgId, pendingAgentTransactionsRef.current);
            }
          },
          });
        } finally {
          thinkingBatcher.flush();
        }
        setMultiAgentOutline(null);
        outlineConfirmResolverRef.current = null;
        pendingAgentTransactionsRef.current = null;
      } else {
        const contentBatcher = createStreamingBatcher(setStreamingContent);
        const thinkingBatcher = createStreamingBatcher(setStreamingThinking);
        setAgentStatus({ state: "running", message: "正在根据需求生成内容..." });
        const onChunk = (chunk: string, done: boolean, isThinking?: boolean) => {
          if (isRunCancelled(runId)) return;
          if (done) {
            contentBatcher.flush();
            thinkingBatcher.flush();
            return;
          }
          if (!chunk) return;
          if (isThinking) {
            thinkingBatcher.push(chunk);
          } else {
            contentBatcher.push(chunk);
          }
        };
        let result: AIResponse;
        try {
          result = await runAssistantSimpleModule(
            moduleDef,
            savedInput,
            selectedStyle,
            onChunk,
            {
              translation: {
                targetLanguage: selectedTranslationTarget,
              },
              contextMessages: priorContextMessages,
            }
          );
        } finally {
          contentBatcher.flush();
          thinkingBatcher.flush();
        }
        if (isRunCancelled(runId)) return;

        const finalText = (result.rawMarkdown ?? result.content).trim();
        const finalPlainText = result.plainText || sanitizeMarkdownToPlainText(finalText);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: "assistant",
          content: finalText,
          plainText: finalPlainText,
          applyContent: finalText,
          thinking: result.thinking || undefined,
          action,
          actionLabel: moduleDef.label,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        conversationManager.addAssistantMessage(
          finalText,
          undefined,
          result.thinking || undefined
        );
        setAgentStatus({ state: "success", message: "内容已生成，尚未写入文档" });
      }

      setStreamingContent("");
      setStreamingThinking("");
    } catch (error) {
      if (isRunCancelled(runId)) return;
      console.error("处理失败:", error);
      const errorText = error instanceof Error ? error.message : "处理失败，请重试";
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: errorText,
        plainText: errorText,
        action,
        actionLabel: moduleDef.label,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStreamingContent("");
      setStreamingThinking("");
      if (moduleDef.kind === "workflow") {
        setAgentStatus({
          state: "error",
          message: errorText,
          actions: buildWorkflowRecoveryActions(action, savedInput),
        });
      }
    } finally {
      if (moduleDef.kind === "workflow") {
        pendingAgentTransactionsRef.current = null;
      }
      if (activeRunIdRef.current === runId) {
        setLoading(false);
        setCurrentAction(null);
        wordBusyRef.current = false;
      }
    }
  };

  handleActionRef.current = handleAction;

  const handleQuickAction = (action: ActionType) => {
    state.setSelectedAction(action);
    if (inputText.trim()) {
      void handleAction(action);
    }
  };

  const handleSend = () => {
    if (inputText.trim() && state.selectedAction) {
      void handleAction(state.selectedAction);
    }
  };

  const handleStop = () => {
    if (!state.loading) return;
    stopRequestedRef.current = true;
    activeRunIdRef.current += 1;
    setLoading(false);
    setCurrentAction(null);
    setStreamingContent("");
    setStreamingThinking("");
    setStreamingThinkingExpanded(false);
    setAgentStatus({ state: "idle" });
    currentSectionTitleRef.current = undefined;
    pendingAgentTransactionsRef.current = null;
    wordBusyRef.current = false;
  };

  return {
    handleAction,
    handleQuickAction,
    handleSend,
    handleStop,
  };
}
