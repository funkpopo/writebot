import { useRef, startTransition } from "react";
import {
  captureBodyUndoSnapshotIfSizeAllows,
  captureScopedUndoSnapshotFromParagraphIndices,
  captureScopedUndoSnapshotFromRanges,
  finalizeUndoSnapshot,
  getParagraphCountInDocument,
  getParagraphIndicesInSelection,
  type UndoSnapshot,
} from "../../../utils/wordApi";
import {
  type AIResponse,
} from "../../../utils/aiService";
import type { ToolCallRequest, ToolCallResult } from "../../../types/tools";
import {
  getAssistantModuleById,
} from "../../../utils/assistantModuleService";
import { runAssistantSimpleModule } from "../../../utils/assistantModuleRuntime";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import { canParallelizeReadToolBatch } from "../../../utils/toolDefinitions";
import {
  loadAgentCheckpoint,
  upsertAgentCheckpointToolReplayEntry,
  type AgentCheckpointFile,
  type AgentCheckpointToolReplayEntry,
  type AgentCheckpointToolReplayStatus,
  type AgentCheckpointToolReplayVerificationStatus,
} from "../../../utils/storageService";
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
import type { ArticleOutline, MultiAgentPhase, ReviewFeedback } from "./multiAgent/types";
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

  const appendPendingAgentUndoSnapshot = (nextSnapshot: UndoSnapshot) => {
    const currentHandle = pendingAgentSnapshotRef.current;
    if (!currentHandle) {
      pendingAgentSnapshotRef.current = { snapshot: nextSnapshot };
      return;
    }

    if (currentHandle.snapshot.kind === "document") {
      return;
    }

    if (nextSnapshot.kind === "document") {
      return;
    }

    currentHandle.snapshot.blocks.push(...nextSnapshot.blocks);
  };

  const captureUndoSnapshotForToolCall = async (
    callToRun: ToolCallRequest,
    toolLabel: string
  ): Promise<UndoSnapshot | null> => {
    if (callToRun.name === "replace_selected_text") {
      const paragraphIndices = await getParagraphIndicesInSelection();
      if (paragraphIndices.length > 0) {
        return captureScopedUndoSnapshotFromParagraphIndices(paragraphIndices, toolLabel);
      }
      return captureBodyUndoSnapshotIfSizeAllows(toolLabel);
    }

    if (callToRun.name === "insert_after_paragraph") {
      const paragraphIndex = Number((callToRun.arguments as { paragraphIndex?: unknown })?.paragraphIndex);
      if (Number.isFinite(paragraphIndex)) {
        return captureScopedUndoSnapshotFromRanges(
          [{ startIndex: paragraphIndex + 1, paragraphCount: 0, description: toolLabel }],
          toolLabel
        );
      }
      return captureBodyUndoSnapshotIfSizeAllows(toolLabel);
    }

    if (callToRun.name === "append_text") {
      const paragraphCount = await getParagraphCountInDocument();
      return captureScopedUndoSnapshotFromRanges(
        [{ startIndex: paragraphCount, paragraphCount: 0, description: toolLabel }],
        toolLabel
      );
    }

    if (callToRun.name === "insert_text") {
      const location = (callToRun.arguments as { location?: unknown })?.location;
      if (location === "start") {
        return captureScopedUndoSnapshotFromRanges(
          [{ startIndex: 0, paragraphCount: 0, description: toolLabel }],
          toolLabel
        );
      }
      if (location === "end") {
        const paragraphCount = await getParagraphCountInDocument();
        return captureScopedUndoSnapshotFromRanges(
          [{ startIndex: paragraphCount, paragraphCount: 0, description: toolLabel }],
          toolLabel
        );
      }

      const paragraphIndices = await getParagraphIndicesInSelection();
      if (paragraphIndices.length > 0) {
        return captureScopedUndoSnapshotFromParagraphIndices(paragraphIndices, toolLabel);
      }
      return captureBodyUndoSnapshotIfSizeAllows(toolLabel);
    }

    return captureBodyUndoSnapshotIfSizeAllows(toolLabel);
  };

  const executeToolCalls = async (
    toolCalls: ToolCallRequest[],
    action: string,
    runId: number,
    writtenSegments?: string[],
    stageWriteGuard?: StageWriteGuardContext
  ): Promise<ToolCallResult[]> => {
    if (isRunCancelled(runId)) return [];

    const labelMap: Record<string, string> = {
      insert_text: "插入文本",
      append_text: "追加文本",
      insert_after_paragraph: "段落后插入",
      replace_selected_text: "替换选中文本",
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

    const replayEntriesByIdempotency = new Map<string, AgentCheckpointToolReplayEntry>();
    const replayEntriesByReplayKey = new Map<string, AgentCheckpointToolReplayEntry[]>();
    let replayLedgerLoaded = false;

    const indexReplayEntries = (entries: AgentCheckpointToolReplayEntry[]) => {
      replayEntriesByIdempotency.clear();
      replayEntriesByReplayKey.clear();
      for (const entry of entries) {
        replayEntriesByIdempotency.set(entry.idempotencyKey, entry);
        const bucket = replayEntriesByReplayKey.get(entry.replayKey) || [];
        bucket.push(entry);
        replayEntriesByReplayKey.set(entry.replayKey, bucket);
      }
    };

    const syncReplayLedgerFromCheckpoint = (checkpointFile: AgentCheckpointFile | null | undefined) => {
      indexReplayEntries(checkpointFile?.recoveryState?.toolReplays || []);
    };

    const upsertReplayLedgerEntryLocally = (entry: AgentCheckpointToolReplayEntry) => {
      replayEntriesByIdempotency.set(entry.idempotencyKey, entry);
      const current = replayEntriesByReplayKey.get(entry.replayKey) || [];
      const next = current.filter((item) => item.idempotencyKey !== entry.idempotencyKey);
      next.push(entry);
      replayEntriesByReplayKey.set(entry.replayKey, next);
    };

    const ensureReplayLedgerLoaded = async () => {
      if (replayLedgerLoaded) return;
      replayLedgerLoaded = true;
      try {
        syncReplayLedgerFromCheckpoint(await loadAgentCheckpoint());
      } catch (error) {
        console.error("加载 checkpoint 重放记录失败:", error);
      }
    };

    const buildReplayLedgerEntry = (
      descriptor: NonNullable<ReturnType<typeof toolExecutor.buildWriteReplayDescriptor>>,
      status: AgentCheckpointToolReplayStatus,
      options?: {
        base?: AgentCheckpointToolReplayEntry;
        verificationStatus?: AgentCheckpointToolReplayVerificationStatus;
        verificationMessage?: string;
      }
    ): AgentCheckpointToolReplayEntry => {
      const timestamp = new Date().toISOString();
      return {
        replayKey: descriptor.replayKey,
        idempotencyKey: descriptor.idempotencyKey,
        toolName: descriptor.toolName,
        toolCallId: descriptor.toolCallId,
        argsDigest: descriptor.argsDigest,
        locationHint: descriptor.locationHint,
        normalizedText: descriptor.normalizedText,
        textHash: descriptor.textHash,
        status,
        verificationStatus: options?.verificationStatus ?? options?.base?.verificationStatus,
        verificationMessage: options?.verificationMessage ?? options?.base?.verificationMessage,
        preparedAt:
          status === "prepared"
            ? (options?.base?.preparedAt || timestamp)
            : options?.base?.preparedAt,
        committedAt:
          status === "committed" || status === "skipped"
            ? (options?.base?.committedAt || timestamp)
            : options?.base?.committedAt,
        updatedAt: timestamp,
      };
    };

    const persistReplayLedgerEntry = async (entry: AgentCheckpointToolReplayEntry) => {
      try {
        const updated = await upsertAgentCheckpointToolReplayEntry(entry);
        if (updated) {
          syncReplayLedgerFromCheckpoint(updated);
          return;
        }
      } catch (error) {
        console.error("保存 checkpoint 重放记录失败:", error);
      }
      upsertReplayLedgerEntryLocally(entry);
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

    if (canParallelizeReadToolBatch(toolCalls) && !isRunCancelled(runId)) {
      const parallelResults = await Promise.all(
        toolCalls.map((call) => executeSingleToolCall(call))
      );
      for (const result of parallelResults) {
        if (isRunCancelled(runId)) return collectedResults;
        conversationManager.addToolResult(result);
        collectedResults.push(result);
      }
      if (parallelResults.some((r) => !r.success)) {
        const failed = parallelResults.filter((r) => !r.success);
        setApplyStatus({
          state: "error",
          message: `以下执行失败：${formatToolList(failed.map((r) => r.name))}。`,
        });
      }
      return collectedResults;
    }

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
      const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
      let callUndoSnapshot: UndoSnapshot | null = null;
      const replayDescriptor = autoApplied ? toolExecutor.buildWriteReplayDescriptor(callToExecute) : null;

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

      if (replayDescriptor) {
        await ensureReplayLedgerLoaded();

        const existingReplay = replayEntriesByIdempotency.get(replayDescriptor.idempotencyKey);
        if (existingReplay && (existingReplay.status === "prepared" || existingReplay.status === "committed")) {
          const validation = await toolExecutor.validateNormalizedWriteReplay(
            existingReplay.normalizedText || replayDescriptor.normalizedText
          );
          if (validation.status === "matched") {
            const nextReplayEntry = buildReplayLedgerEntry(replayDescriptor, "committed", {
              base: existingReplay,
              verificationStatus: "matched",
              verificationMessage: validation.message,
            });
            await persistReplayLedgerEntry(nextReplayEntry);
            result = {
              id: call.id,
              name: call.name,
              success: true,
              result: "检测到恢复记录中的相同写入已落盘，已跳过重复写入",
            };
            conversationManager.addToolResult(result);
            collectedResults.push(result);
            pushUnique(autoAppliedToolLabels, toolLabel);
            if (typeof maybeTextArg === "string" && maybeTextArg.trim()) {
              writtenSegments?.push(maybeTextArg.trim());
            }
            continue;
          }
        }

        const conflictingReplay = (replayEntriesByReplayKey.get(replayDescriptor.replayKey) || [])
          .find((entry) =>
            entry.idempotencyKey !== replayDescriptor.idempotencyKey
            && (entry.status === "prepared" || entry.status === "committed" || entry.status === "skipped")
          );
        if (conflictingReplay && conflictingReplay.normalizedText) {
          const validation = await toolExecutor.validateNormalizedWriteReplay(conflictingReplay.normalizedText);
          if (validation.status === "matched") {
            const nextReplayEntry = {
              ...conflictingReplay,
              status: "committed" as const,
              verificationStatus: "conflict" as const,
              verificationMessage: validation.message,
              committedAt: conflictingReplay.committedAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await persistReplayLedgerEntry(nextReplayEntry);
            result = {
              id: call.id,
              name: call.name,
              success: true,
              result: "检测到断点恢复步骤已写入其他内容，已跳过重复写入并阻止不一致重放",
            };
            conversationManager.addToolResult(result);
            collectedResults.push(result);
            pushUnique(autoAppliedToolLabels, toolLabel);
            if (typeof conflictingReplay.normalizedText === "string" && conflictingReplay.normalizedText.trim()) {
              writtenSegments?.push(conflictingReplay.normalizedText.trim());
            }
            continue;
          }
        }
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
          if (replayDescriptor) {
            await persistReplayLedgerEntry(buildReplayLedgerEntry(replayDescriptor, "skipped", {
              base: replayEntriesByIdempotency.get(replayDescriptor.idempotencyKey),
              verificationStatus: "pending",
              verificationMessage: "命中运行时 writtenSegments 去重",
            }));
          }
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
        try {
          callUndoSnapshot = await captureUndoSnapshotForToolCall(callToExecute, toolLabel);
        } catch (error) {
          console.error("捕获 AI 写入撤销快照失败:", error);
        }
      }

      if (replayDescriptor) {
        await persistReplayLedgerEntry(buildReplayLedgerEntry(replayDescriptor, "prepared", {
          base: replayEntriesByIdempotency.get(replayDescriptor.idempotencyKey),
          verificationStatus: "pending",
          verificationMessage: "写入前已登记重放校验信息",
        }));
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

      if (replayDescriptor) {
        await persistReplayLedgerEntry(
          buildReplayLedgerEntry(replayDescriptor, result.success ? "committed" : "failed", {
            base: replayEntriesByIdempotency.get(replayDescriptor.idempotencyKey),
            verificationStatus: result.success ? "pending" : "missing",
            verificationMessage: result.success ? "写入完成，等待恢复重放时校验" : (result.error || "工具执行失败"),
          })
        );
      }

      if (retryCount > 0) {
        if (result.success) {
          pushUnique(retriedSuccessToolLabels, toolLabel);
        } else {
          pushUnique(retryExhaustedToolLabels, toolLabel);
        }
      }
      if (result.success && autoApplied) {
        pushUnique(autoAppliedToolLabels, toolLabel);
        if (callUndoSnapshot) {
          try {
            const paragraphCountAfter = await getParagraphCountInDocument();
            appendPendingAgentUndoSnapshot(finalizeUndoSnapshot(callUndoSnapshot, paragraphCountAfter));
          } catch (error) {
            console.error("完成 AI 写入撤销快照失败:", error);
          }
        }
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
    pendingAgentSnapshotRef.current = null;
    if (moduleDef.kind === "workflow") {
      setAgentPlanView(null);
      setAgentStatus({ state: "idle" });
    }
    wordBusyRef.current = true;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputText,
      action,
      actionLabel: moduleDef.label,
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
    if (moduleDef.kind !== "workflow" && agentStatus.state !== "idle") {
      setAgentStatus({ state: "idle" });
    }

    try {
      if (moduleDef.kind === "workflow") {
        // ── Multi-Agent Pipeline ──
        setAgentStatus({ state: "running", message: "正在分析需求并生成文章大纲..." });
        setMultiAgentPhase("planning");

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
            if (pendingAgentSnapshotRef.current) {
              appliedSnapshotsRef.current.set(msgId, pendingAgentSnapshotRef.current);
            }
          },
        });
        setMultiAgentOutline(null);
        outlineConfirmResolverRef.current = null;
        pendingAgentSnapshotRef.current = null;
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
        const result: AIResponse = await runAssistantSimpleModule(
          moduleDef,
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
        pendingAgentSnapshotRef.current = null;
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
    pendingAgentSnapshotRef.current = null;
    wordBusyRef.current = false;
  };

  return {
    handleAction,
    handleQuickAction,
    handleSend,
    handleStop,
  };
}
