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
import type { ActionType, Message } from "./types";
import type { StageWriteGuardContext } from "./stageWriteGuard";
import { runAgentToolCalls } from "./agentToolRunner";
import type { ArticleOutline, MultiAgentPhase, ReviewFeedback, ReviewCycleOutcome } from "./multiAgent/types";
import type { AssistantState } from "./useAssistantState";

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
        const contentBatcher = createStreamingBatcher(setStreamingContent);
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
                setAgentStatus({ state: "success", message: message || "文章撰写完成" });
              } else if (phase === "error") {
                setAgentStatus({ state: "error", message: message || "执行失败" });
              } else if (phase === "idle") {
                setAgentStatus({ state: "idle", message });
              } else {
                setAgentStatus({ state: "running", message });
              }

              const progress = extractSectionProgressFromMessage(message);
              if (progress && (phase === "writing" || phase === "revising")) {
                setAgentPlanView((prev) => {
                  const sameTotal = prev?.totalStages === progress.total;
                  const nextCurrent = sameTotal
                    ? Math.max(prev?.currentStage || 0, progress.current)
                    : progress.current;
                  const nextCompleted = sameTotal ? (prev?.completedStages || []) : [];
                  const nextContent = prev?.content || "";
                  const unchanged = Boolean(
                    prev
                    && prev.currentStage === nextCurrent
                    && prev.totalStages === progress.total
                    && prev.content === nextContent
                    && prev.completedStages.length === nextCompleted.length
                    && prev.completedStages.every((value, index) => value === nextCompleted[index])
                  );
                  if (unchanged && prev) {
                    return prev;
                  }
                  return {
                    content: nextContent,
                    currentStage: nextCurrent,
                    totalStages: progress.total,
                    completedStages: nextCompleted,
                    updatedAt: new Date().toISOString(),
                  };
                });
              }
            });
          },
          onOutlineReady: (outline) => {
            return new Promise<boolean>((resolve) => {
              if (isRunCancelled(runId)) { resolve(false); return; }
              startTransition(() => {
                setAgentPlanView({
                  content: toPlanMarkdownFromOutline(outline),
                  currentStage: 0,
                  totalStages: Math.max(1, outline.sections.length),
                  completedStages: [],
                  updatedAt: new Date().toISOString(),
                });
                setMultiAgentOutline(outline);
                setMultiAgentPhase("awaiting_confirmation");
              });
              outlineConfirmResolverRef.current = resolve;
            });
          },
          onSectionStart: (sectionIndex, total, _title) => {
            if (isRunCancelled(runId)) return;
            startTransition(() => {
              setAgentPlanView((prev) => {
                const currentStage = Math.max(sectionIndex + 1, prev?.currentStage || 0);
                const completedStages = prev?.completedStages || [];
                const content = prev?.content || "";
                const unchanged = Boolean(
                  prev
                  && prev.currentStage === currentStage
                  && prev.totalStages === total
                  && prev.content === content
                  && prev.completedStages.length === completedStages.length
                  && prev.completedStages.every((value, index) => value === completedStages[index])
                );
                if (unchanged && prev) {
                  return prev;
                }
                return {
                  content,
                  currentStage,
                  totalStages: total,
                  completedStages,
                  updatedAt: new Date().toISOString(),
                };
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
                return {
                  content: prev?.content || "",
                  currentStage,
                  totalStages: total,
                  completedStages,
                  updatedAt: new Date().toISOString(),
                };
              });
            });
          },
          onReviewResult: (feedback: ReviewFeedback) => {
            if (isRunCancelled(runId)) return;
            const scoreText = `评分 ${feedback.overallScore}/10`;
            const issueCount = feedback.sectionFeedback.filter((s) => s.needsRevision).length;
            const summary = issueCount > 0
              ? `${scoreText}，${issueCount} 个章节需要修改`
              : `${scoreText}，质量良好`;
            addMessage({
              id: `${Date.now().toString(36)}_review`,
              type: "assistant",
              content: `审阅结果：${summary}`,
              plainText: `审阅结果：${summary}`,
              action,
              actionLabel: moduleDef.label,
              uiOnly: true,
              timestamp: new Date(),
            });
          },
          onChunk: (chunk, done, isThinking) => {
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
              applyContent: content,
              thinking: options?.thinking,
              action,
              actionLabel: moduleDef.label,
              uiOnly: options?.uiOnly ?? true,
              timestamp: new Date(),
            });
          },
          onDocumentSnapshot: (text, _label) => {
            if (isRunCancelled(runId)) return;
            const trimmed = text.trim();
            if (!trimmed) return;
            const msgId = `${Date.now().toString(36)}_snap_${Math.random().toString(36).slice(2, 6)}`;
            addMessage({
              id: msgId,
              type: "assistant",
              content: trimmed,
              plainText: sanitizeMarkdownToPlainText(trimmed),
              applyContent: trimmed,
              action,
              actionLabel: moduleDef.label,
              timestamp: new Date(),
            });
            // Content is already in the document, auto-mark as applied
            markApplied(msgId);
            if (pendingAgentTransactionsRef.current) {
              appliedTransactionsRef.current.set(msgId, pendingAgentTransactionsRef.current);
            }
          },
          onReviewCycleComplete: (outcome: ReviewCycleOutcome) => {
            if (isRunCancelled(runId)) return;
            const summaryParts: string[] = [];
            if (outcome.qualityGatePassed) {
              summaryParts.push("审查门控通过");
            } else {
              summaryParts.push("审查门控未通过");
            }
            if (outcome.revisionPerformed) {
              summaryParts.push("已执行修订");
            }
            if (outcome.needsReplan) {
              summaryParts.push("建议重新规划");
              if (outcome.reasons.length > 0) {
                summaryParts.push(`原因：${outcome.reasons.join(", ")}`);
              }
            }
            addMessage({
              id: `${Date.now().toString(36)}_reviewcycle`,
              type: "assistant",
              content: `审校循环结果：${summaryParts.join("，")}`,
              plainText: `审校循环结果：${summaryParts.join("，")}`,
              action,
              actionLabel: moduleDef.label,
              uiOnly: true,
              timestamp: new Date(),
            });
          },
          onRequestReplan: async (reasons: string[]) => {
            if (isRunCancelled(runId)) return false;
            const reasonText = reasons.length > 0
              ? `原因：${reasons.join("、")}`
              : "质量门控未通过";
            // Use confirm dialog since we don't have a custom replan UI component yet
            try {
              return window.confirm(
                `文章质量门控未通过，建议重新规划并重新生成文章。\n\n${reasonText}\n\n确认后将清除已有内容并重新开始。\n\n是否重新规划？`
              );
            } catch {
              return false;
            }
          },
          });
        } finally {
          contentBatcher.flush();
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
        setAgentStatus({ state: "error", message: errorText });
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
