import { useRef } from "react";
import {
  getDocumentOoxml,
} from "../../../utils/wordApi";
import {
  type AIResponse,
} from "../../../utils/aiService";
import type { ToolCallRequest, ToolCallResult } from "../../../types/tools";
import {
  getActionDef,
  type ActionId,
} from "../../../utils/actionRegistry";
import { runSimpleAction } from "../../../utils/actionRunners";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import type { ActionType, Message } from "./types";
import {
  ensureTrailingNewlineForInsertion,
  stripSourceAnchorMarkersFromWriteText,
  stripAgentExecutionMarkersFromWriteText,
  type StageWriteGuardContext,
} from "./stageWriteGuard";
import {
  isRetryableWriteToolError,
  MAX_WRITE_TOOL_RETRIES,
} from "./toolRetryPolicy";
import { runMultiAgentPipeline } from "./multiAgent/orchestrator";
import type { MultiAgentPhase, ReviewFeedback } from "./multiAgent/types";
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
    agentStatus,
    conversationManager,
    toolExecutor,
    appliedSnapshotsRef,
    pendingAgentSnapshotRef,
    lastAgentOutputRef,
    agentHasToolOutputsRef,
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

  const beginRun = (): number => {
    stopRequestedRef.current = false;
    activeRunIdRef.current += 1;
    return activeRunIdRef.current;
  };

  const isRunCancelled = (runId: number): boolean => {
    return stopRequestedRef.current || activeRunIdRef.current !== runId;
  };

  const executeToolCalls = async (
    toolCalls: ToolCallRequest[],
    action: ActionId,
    runId: number,
    writtenSegments?: string[],
    stageWriteGuard?: StageWriteGuardContext
  ): Promise<ToolCallResult[]> => {
    if (isRunCancelled(runId)) return [];
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
      insert_after_paragraph: "段落后插入",
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
        action,
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
      return ["insert_text", "append_text", "insert_after_paragraph", "replace_selected_text"].includes(toolName);
    };

    const shouldForceTrailingNewline = (toolName: string): boolean => {
      return isAutoAppliedTool(toolName);
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

    const waitForMs = (ms: number): Promise<void> => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };

    const executeSingleToolCall = async (callToRun: ToolCallRequest): Promise<ToolCallResult> => {
      if (callToRun.name === "restore_snapshot") {
        const confirmation = requestUserConfirmation("将把文档恢复到本轮 AI 操作前的状态，是否继续？", {
          defaultWhenUnavailable: false,
        });
        if (!confirmation.confirmed) {
          return {
            id: callToRun.id,
            name: callToRun.name,
            success: false,
            error: confirmation.usedFallback
              ? "当前环境不支持确认弹窗，已取消恢复操作"
              : "用户取消恢复操作",
          };
        }
      }
      return toolExecutor.execute(callToRun);
    };

    const autoAppliedToolLabels: string[] = [];
    const failedToolLabels: string[] = [];
    const retriedSuccessToolLabels: string[] = [];
    const retryExhaustedToolLabels: string[] = [];
    const collectedResults: ToolCallResult[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      if (isRunCancelled(runId)) return collectedResults;
      const call = toolCalls[i];
      const rawTextArg =
        call.arguments && typeof call.arguments === "object"
          ? (call.arguments as { text?: unknown }).text
          : undefined;
      const autoApplied = isAutoAppliedTool(call.name);
      let maybeTextArg = typeof rawTextArg === "string" ? rawTextArg : undefined;
      let callToExecute = call;

      if (autoApplied && typeof maybeTextArg === "string" && maybeTextArg.trim()) {
        const guardResult = stripAgentExecutionMarkersFromWriteText(maybeTextArg, stageWriteGuard);
        if (guardResult.removedMarker) {
          maybeTextArg = guardResult.text;
          callToExecute = {
            ...call,
            arguments: {
              ...(call.arguments || {}),
              text: guardResult.text,
            },
          };
          console.warn(`[agent] Removed stage marker before ${call.name} write`);
        }
      }

      if (autoApplied && typeof maybeTextArg === "string" && maybeTextArg.trim()) {
        const anchorStripResult = stripSourceAnchorMarkersFromWriteText(maybeTextArg);
        if (anchorStripResult.removedMarker) {
          maybeTextArg = anchorStripResult.text;
          callToExecute = {
            ...callToExecute,
            arguments: {
              ...(callToExecute.arguments || {}),
              text: anchorStripResult.text,
            },
          };
          console.warn(`[agent] Removed source-anchor marker before ${call.name} write`);
        }
      }

      if (shouldForceTrailingNewline(call.name) && typeof maybeTextArg === "string" && maybeTextArg.trim()) {
        const normalizedText = ensureTrailingNewlineForInsertion(maybeTextArg);
        if (normalizedText !== maybeTextArg) {
          maybeTextArg = normalizedText;
          callToExecute = {
            ...callToExecute,
            arguments: {
              ...(callToExecute.arguments || {}),
              text: normalizedText,
            },
          };
        }
      }

      let result: ToolCallResult;
      let retryCount = 0;

      if (autoApplied && typeof maybeTextArg === "string" && !maybeTextArg.trim()) {
        result = {
          id: call.id,
          name: call.name,
          success: true,
          result: "仅检测到阶段指示内容，已跳过写入",
        };
        conversationManager.addToolResult(result);
        collectedResults.push(result);
        continue;
      }

      // ── Deduplication: skip write-tool calls whose content was already written ──
      if (
        autoApplied
        && typeof maybeTextArg === "string"
        && maybeTextArg.trim()
      ) {
        const trimmedNew = maybeTextArg.trim();
        const isDuplicate =
          (writtenSegments ?? []).some((seg: string) => seg === trimmedNew);
        if (isDuplicate) {
          result = {
            id: call.id,
            name: call.name,
            success: true,
            result: "该内容已存在于文档中，已跳过重复写入",
          };
          conversationManager.addToolResult(result);
          collectedResults.push(result);
          console.warn(`[agent] Skipped duplicate ${call.name} (content already written)`);
          continue;
        }
      }

      if (autoApplied) {
        while (true) {
          result = await executeSingleToolCall(callToExecute);
          if (result.success) break;

          const canRetry =
            retryCount < MAX_WRITE_TOOL_RETRIES && isRetryableWriteToolError(result.error);
          if (!canRetry) break;

          retryCount += 1;
          const delayMs = Math.min(300 * retryCount, 1200);
          console.warn(
            `[agent] ${call.name} 执行失败，准备重试 ${retryCount}/${MAX_WRITE_TOOL_RETRIES}`,
            result.error
          );
          const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
          setApplyStatus({
            state: "retrying",
            message: `${toolLabel} 执行失败，正在重试（${retryCount}/${MAX_WRITE_TOOL_RETRIES}）...`,
          });
          await waitForMs(delayMs);
        }
      } else {
        result = await executeSingleToolCall(callToExecute);
      }

      conversationManager.addToolResult(result);
      collectedResults.push(result);

      const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
      if (retryCount > 0) {
        if (result.success) {
          pushUnique(retriedSuccessToolLabels, toolLabel);
        } else {
          pushUnique(retryExhaustedToolLabels, toolLabel);
        }
      }
      if (result.success && autoApplied) {
        pushUnique(autoAppliedToolLabels, toolLabel);
      }
      if (!result.success) {
        pushUnique(failedToolLabels, toolLabel);
      }

      // Keep dedup state for future rounds, but avoid adding a second
      // "tool call" bubble because section snapshots already surface
      // the same content as the canonical result message.
      if (
        result.success
        && typeof maybeTextArg === "string"
        && maybeTextArg.trim()
        && autoApplied
      ) {
        // Track written content for cross-round deduplication.
        writtenSegments?.push(maybeTextArg.trim());
      }
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length === 0) {
      const retrySuffix =
        retriedSuccessToolLabels.length > 0
          ? `（其中 ${formatToolList(retriedSuccessToolLabels)} 为重试后成功）`
          : "";
      setApplyStatus({
        state: "success",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}${retrySuffix}`,
      });
      return collectedResults;
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length > 0) {
      const retrySuffix =
        retriedSuccessToolLabels.length > 0
          ? `（部分工具重试成功：${formatToolList(retriedSuccessToolLabels)}）`
          : "";
      setApplyStatus({
        state: "warning",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}${retrySuffix}；但以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
      return collectedResults;
    }

    if (failedToolLabels.length > 0) {
      const retryHint =
        retryExhaustedToolLabels.length > 0
          ? `（已自动重试仍失败：${formatToolList(retryExhaustedToolLabels)}）`
          : "";
      setApplyStatus({
        state: "error",
        message: `以下执行失败：${formatToolList(failedToolLabels)}${retryHint}。`,
      });
    }
    return collectedResults;
  };

  const handleAction = async (action: ActionType) => {
    if (!inputText.trim() || !action) return;
    const runId = beginRun();
    const actionDef = getActionDef(action);
    if (!actionDef) {
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
    if (actionDef.kind === "agent") {
      setAgentPlanView(null);
      setAgentStatus({ state: "idle" });
    }
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
    if (actionDef.kind !== "agent" && agentStatus.state !== "idle") {
      setAgentStatus({ state: "idle" });
    }

    try {
      if (actionDef.kind === "agent") {
        // ── Multi-Agent Pipeline ──
        setAgentStatus({ state: "running", message: "正在分析需求并生成文章大纲..." });
        setMultiAgentPhase("planning");

        await runMultiAgentPipeline(savedInput, {
          onPhaseChange: (phase: MultiAgentPhase, message?: string) => {
            if (isRunCancelled(runId)) return;
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
          },
          onOutlineReady: (outline) => {
            return new Promise<boolean>((resolve) => {
              if (isRunCancelled(runId)) { resolve(false); return; }
              setMultiAgentOutline(outline);
              setMultiAgentPhase("awaiting_confirmation");
              outlineConfirmResolverRef.current = resolve;
            });
          },
          onSectionStart: (sectionIndex, total, _title) => {
            if (isRunCancelled(runId)) return;
            setAgentPlanView((prev) => ({
              content: prev?.content || "",
              currentStage: sectionIndex + 1,
              totalStages: total,
              completedStages: prev?.completedStages || [],
              updatedAt: new Date().toISOString(),
            }));
          },
          onSectionDone: (sectionIndex, total, _title) => {
            if (isRunCancelled(runId)) return;
            setAgentPlanView((prev) => ({
              content: prev?.content || "",
              currentStage: sectionIndex + 1,
              totalStages: total,
              completedStages: [...(prev?.completedStages || []), sectionIndex + 1],
              updatedAt: new Date().toISOString(),
            }));
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
              uiOnly: true,
              timestamp: new Date(),
            });
          },
          onChunk: (chunk, done, isThinking) => {
            if (isRunCancelled(runId)) return;
            if (done || !chunk) return;
            if (isThinking) {
              setStreamingThinking((prev) => prev + chunk);
            } else {
              setStreamingContent((prev) => prev + chunk);
            }
          },
          onToolCalls: () => {},
          executeToolCalls: async (toolCalls, writtenSegments) => {
            if (isRunCancelled(runId)) return [];
            return executeToolCalls(toolCalls, action, runId, writtenSegments);
          },
          isRunCancelled: () => isRunCancelled(runId),
          addChatMessage: (content, options) => {
            if (isRunCancelled(runId)) return;
            addMessage({
              id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              type: "assistant",
              content,
              plainText: sanitizeMarkdownToPlainText(content),
              thinking: options?.thinking,
              action,
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
              action,
              timestamp: new Date(),
            });
            // Content is already in the document, auto-mark as applied
            markApplied(msgId);
            if (pendingAgentSnapshotRef.current) {
              appliedSnapshotsRef.current.set(msgId, pendingAgentSnapshotRef.current);
            }
          },
        });
        setMultiAgentOutline(null);
        outlineConfirmResolverRef.current = null;
      } else {
        const onChunk = (chunk: string, done: boolean, isThinking?: boolean) => {
          if (isRunCancelled(runId)) return;
          if (done) return;
          if (!chunk) return;
          if (isThinking) {
            setStreamingThinking((prev) => prev + chunk);
          } else {
            setStreamingContent((prev) => prev + chunk);
          }
        };
        const result: AIResponse = await runSimpleAction(
          action,
          savedInput,
          selectedStyle,
          onChunk,
          {
            translation: {
              targetLanguage: selectedTranslationTarget,
            },
          }
        );
        if (isRunCancelled(runId)) return;

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
      if (isRunCancelled(runId)) return;
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
      if (actionDef.kind === "agent") {
        setAgentStatus({ state: "error", message: errorText });
      }
    } finally {
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
    wordBusyRef.current = false;
  };

  return {
    handleAction,
    handleQuickAction,
    handleSend,
    handleStop,
  };
}
