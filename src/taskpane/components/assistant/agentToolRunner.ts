import type { ConversationManager } from "../../../utils/conversationManager";
import { editTransactionService } from "../../../utils/editTransactionService";
import {
  loadAgentCheckpoint,
  upsertAgentCheckpointToolReplayEntry,
  type AgentCheckpointFile,
  type AgentCheckpointToolReplayEntry,
  type AgentCheckpointToolReplayStatus,
  type AgentCheckpointToolReplayVerificationStatus,
} from "../../../utils/storageService";
import type { ToolExecutor } from "../../../utils/toolExecutor";
import { canParallelizeReadToolBatch, getToolDefinition, isAgentAutoExecutableTool } from "../../../utils/toolDefinitions";
import type { AgentPermissionMode, ToolCallRequest, ToolCallResult } from "../../../types/tools";
import { reviewAssistantWriteContent } from "./contentReview";
import {
  ensureTrailingNewlineForInsertion,
  stripSourceAnchorMarkersFromWriteText,
  stripAgentExecutionMarkersFromWriteText,
  type StageWriteGuardContext,
} from "./stageWriteGuard";
import type { AssistantState } from "./useAssistantState";

type SetApplyStatus = AssistantState["setApplyStatus"];

export interface AgentToolRunnerContext {
  agentPermissionMode: AgentPermissionMode;
  appendPendingAgentTransaction: (transactionId: string, operationGroupId?: string) => void;
  conversationManager: ConversationManager;
  isRunCancelled: (runId: number) => boolean;
  requestUserConfirmation: (
    message: string,
    options?: { defaultWhenUnavailable?: boolean }
  ) => { confirmed: boolean; usedFallback: boolean };
  setApplyStatus: SetApplyStatus;
  toolExecutor: ToolExecutor;
}
export async function runAgentToolCalls(
  toolCalls: ToolCallRequest[],
  action: string,
  runId: number,
  userInput: string,
  writtenSegments: string[] | undefined,
  stageWriteGuard: StageWriteGuardContext | undefined,
  context: AgentToolRunnerContext
): Promise<ToolCallResult[]> {
  const {
    agentPermissionMode,
    appendPendingAgentTransaction,
    conversationManager,
    isRunCancelled,
    requestUserConfirmation,
    setApplyStatus,
    toolExecutor,
  } = context;

  if (isRunCancelled(runId)) return [];

    const labelMap: Record<string, string> = {
      get_document_index: "读取文档结构",
      read_document_ranges: "读取局部段落",
      read_nearby_context: "读取上下文",
      search_document: "搜索文档",
      insert_text: "插入文本",
      append_text: "追加文本",
      insert_after_paragraph: "段落后插入",
      replace_selected_text: "替换选中文本",
      replace_paragraph_range: "替换段落范围",
      insert_at_anchor: "按锚点插入",
      delete_paragraph_range: "删除段落范围",
      rewrite_paragraph: "重写段落",
      apply_edit_transaction: "提交编辑事务",
    };

    const isAutoAppliedTool = (toolName: string): boolean => {
      return isAgentAutoExecutableTool(toolName);
    };

    // 结构化事务写入的文本由 writer agent 流程产出，并被
    // duplicate-write 指纹与 transaction ledger 锁定（operationGroupId 基于
    // 原文 hash）。写入前再让另一个模型改写文本会破坏该确定性契约，
    // 恢复运行时会因 ledger 内容 hash 不一致直接报错，因此跳过这层审查。
    const STRUCTURED_TRANSACTION_TOOL_NAMES = new Set([
      "insert_at_anchor",
      "replace_paragraph_range",
      "rewrite_paragraph",
      "delete_paragraph_range",
      "apply_edit_transaction",
    ]);

    const shouldReviewWriteContent = (toolName: string): boolean => {
      return isAutoAppliedTool(toolName) && !STRUCTURED_TRANSACTION_TOOL_NAMES.has(toolName);
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

    const riskLabelMap: Record<string, string> = {
      read: "只读",
      suggest: "建议",
      write: "写入",
      destructive: "高风险",
    };

    const scopeLabelMap: Record<string, string> = {
      selection: "当前选区",
      cursor: "当前光标",
      paragraph: "指定段落",
      document: "整篇文档",
      format: "格式",
      snapshot: "文档快照",
    };

    const summarizeToolArguments = (args?: Record<string, unknown>): string => {
      if (!args || Object.keys(args).length === 0) return "无";
      const entries = Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .slice(0, 5)
        .map(([key, value]) => {
          if (typeof value === "string") {
            const compact = value.replace(/\s+/g, " ").trim();
            return `${key}: ${compact.length > 80 ? `${compact.slice(0, 80)}...` : compact}`;
          }
          if (Array.isArray(value)) {
            return `${key}: [${value.slice(0, 8).join(", ")}${value.length > 8 ? ", ..." : ""}]`;
          }
          if (value && typeof value === "object") {
            return `${key}: ${JSON.stringify(value).slice(0, 100)}`;
          }
          return `${key}: ${String(value)}`;
        });
      return entries.length > 0 ? entries.join("\n") : "无";
    };

    const describeRangeRead = (args?: Record<string, unknown>): string => {
      const ranges = Array.isArray(args?.ranges) ? args?.ranges as Array<Record<string, unknown>> : [];
      if (ranges.length > 0) {
        const first = ranges[0];
        const start = first?.start;
        const end = first?.end ?? start;
        return `正在读取第 ${String(start)}-${String(end)} 段...`;
      }
      const indices = Array.isArray(args?.paragraphIndices) ? args?.paragraphIndices : [];
      if (indices.length > 0) {
        return `正在读取 ${indices.length} 个指定段落...`;
      }
      const headingPath = Array.isArray(args?.headingPath) ? args?.headingPath.join(" / ") : "";
      if (headingPath) {
        return `正在读取「${headingPath}」下的正文...`;
      }
      return "正在读取局部段落...";
    };

    const confirmToolCallIfNeeded = (callToRun: ToolCallRequest): ToolCallResult | null => {
      const tool = getToolDefinition(callToRun.name);
      if (tool && !tool.requiresConfirmation) return null;
      if (agentPermissionMode === "full_access") return null;
      if (agentPermissionMode === "auto_review" && tool?.riskLevel !== "destructive") return null;

      const toolName = tool?.description ? `${tool.description}（${callToRun.name}）` : callToRun.name;
      const riskLabel = riskLabelMap[tool?.riskLevel || "destructive"] || "未知";
      const scopeLabel = scopeLabelMap[tool?.scope || "document"] || "未知";
      const confirmation = requestUserConfirmation(
        [
          "AI 即将执行需要确认的工具调用，是否继续？",
          "",
          `工具：${toolName}`,
          `风险等级：${riskLabel}`,
          `作用范围：${scopeLabel}`,
          `支持撤销：${tool?.supportsUndo ? "是" : "否"}`,
          "",
          "参数摘要：",
          summarizeToolArguments(callToRun.arguments),
        ].join("\n"),
        { defaultWhenUnavailable: false }
      );

      if (confirmation.confirmed) return null;

      return {
        id: callToRun.id,
        name: callToRun.name,
        success: false,
        error: confirmation.usedFallback
          ? "当前环境不支持确认弹窗，已取消需要确认的工具调用"
          : "用户取消工具调用",
      };
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
      const deniedResult = confirmToolCallIfNeeded(callToRun);
      if (deniedResult) {
        return deniedResult;
      }
      return toolExecutor.execute(callToRun);
    };

    const resolveCommittedTransactionResult = async (
      currentResult: ToolCallResult
    ): Promise<ToolCallResult> => {
      if (currentResult.success || typeof currentResult.error !== "string") {
        return currentResult;
      }
      const transactionIdMatch = currentResult.error.match(/tx_[0-9a-z_]+/i);
      const transactionId = transactionIdMatch?.[0];
      if (!transactionId) {
        return currentResult;
      }
      try {
        const inspection = await editTransactionService.inspectUnknownCommitState(transactionId);
        if (inspection.status !== "already_committed") {
          return currentResult;
        }
        return {
          ...currentResult,
          success: true,
          error: undefined,
          result: {
            transactionId,
            status: inspection.transaction.status,
            operationType: inspection.transaction.operation.type,
            recovered: true,
          },
        };
      } catch (inspectionError) {
        console.warn("事务自动校验失败，保留原始工具错误:", inspectionError);
        return currentResult;
      }
    };

    const buildUnknownCommitActions = (errorMessage: string) => {
      const match = errorMessage.match(/unknown_commit_state:(tx_[0-9a-z_]+):/i);
      const transactionId = match?.[1];
      if (!transactionId) return undefined;
      return [{
        label: "检查并重提",
        action: async () => {
          const inspection = await editTransactionService.inspectUnknownCommitState(transactionId);
          if (inspection.status === "already_committed") {
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
            await editTransactionService.retryUnknownCommit(transactionId);
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
        },
      }];
    };

    const autoAppliedToolLabels: string[] = [];
    const failedToolLabels: string[] = [];
    const collectedResults: ToolCallResult[] = [];

    const appendBlockedRemainingToolResults = (startIndex: number, reason: string): void => {
      for (let j = startIndex; j < toolCalls.length; j += 1) {
        const blockedCall = toolCalls[j];
        const blockedResult: ToolCallResult = {
          id: blockedCall.id,
          name: blockedCall.name,
          success: false,
          error: reason,
        };
        conversationManager.addToolResult(blockedResult);
        collectedResults.push(blockedResult);
        pushUnique(failedToolLabels, `${labelMap[blockedCall.name] || blockedCall.name}（已阻断）`);
      }
    };

    if (canParallelizeReadToolBatch(toolCalls) && !isRunCancelled(runId)) {
      setApplyStatus({
        state: "reviewing",
        message: `正在并行读取：${formatToolList(toolCalls.map((call) => labelMap[call.name] || call.name))}...`,
      });
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
      if (parallelResults.every((r) => r.success)) {
        setApplyStatus(null);
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
      let result: ToolCallResult;

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

      if (shouldReviewWriteContent(call.name) && typeof maybeTextArg === "string" && maybeTextArg.trim()) {
        setApplyStatus({
          state: "reviewing",
          message: `${labelMap[call.name] || call.name}：正在审查待写入内容...`,
        });
        const reviewResult = await reviewAssistantWriteContent(maybeTextArg, userInput);
        if (reviewResult.blocked) {
          result = {
            id: call.id,
            name: call.name,
            success: false,
            error: `内容审查未通过：${reviewResult.messages.join("；")}`,
          };
          conversationManager.addToolResult(result);
          collectedResults.push(result);
          pushUnique(failedToolLabels, `${labelMap[call.name] || call.name}（内容审查未通过）`);
          setApplyStatus({
            state: "error",
            message: `已停止写入：${reviewResult.messages.join("；")}。请让 AI 重新生成后再写入。`,
          });
          continue;
        }
        if (reviewResult.changed) {
          maybeTextArg = shouldForceTrailingNewline(call.name)
            ? ensureTrailingNewlineForInsertion(reviewResult.text)
            : reviewResult.text;
          callToExecute = {
            ...callToExecute,
            arguments: {
              ...(callToExecute.arguments || {}),
              text: maybeTextArg,
            },
          };
          setApplyStatus({
            state: "reviewing",
            message: `${labelMap[call.name] || call.name}：${reviewResult.messages.join("；")}，准备写入...`,
          });
        }
      }

      const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
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

      if (!autoApplied && (call.name === "get_document_index" || call.name === "read_document_ranges" || call.name === "read_nearby_context" || call.name === "search_document")) {
        const readMessage = call.name === "get_document_index"
          ? "正在读取文档结构..."
          : call.name === "read_document_ranges"
            ? describeRangeRead(call.arguments)
            : call.name === "search_document"
              ? "正在搜索文档..."
              : "正在读取附近上下文...";
        setApplyStatus({
          state: "reviewing",
          message: readMessage,
        });
      }

      if (replayDescriptor) {
        await ensureReplayLedgerLoaded();

        const existingReplay = replayEntriesByIdempotency.get(replayDescriptor.idempotencyKey);
        if (existingReplay && (existingReplay.status === "prepared" || existingReplay.status === "committed")) {
          const validation = await toolExecutor.validateNormalizedWriteReplay(
            existingReplay.normalizedText || replayDescriptor.normalizedText
          );
          if (validation.status === "unsupported") {
            result = {
              id: call.id,
              name: call.name,
              success: false,
              error: validation.message,
            };
            conversationManager.addToolResult(result);
            collectedResults.push(result);
            pushUnique(failedToolLabels, `${toolLabel}（重放校验不可用）`);
            setApplyStatus({
              state: "error",
              message: validation.message,
            });
            appendBlockedRemainingToolResults(i + 1, validation.message);
            return collectedResults;
          }
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
          if (validation.status === "unsupported") {
            result = {
              id: call.id,
              name: call.name,
              success: false,
              error: validation.message,
            };
            conversationManager.addToolResult(result);
            collectedResults.push(result);
            pushUnique(failedToolLabels, `${toolLabel}（重放校验不可用）`);
            setApplyStatus({
              state: "error",
              message: validation.message,
            });
            appendBlockedRemainingToolResults(i + 1, validation.message);
            return collectedResults;
          }
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

      if (replayDescriptor) {
        await persistReplayLedgerEntry(buildReplayLedgerEntry(replayDescriptor, "prepared", {
          base: replayEntriesByIdempotency.get(replayDescriptor.idempotencyKey),
          verificationStatus: "pending",
          verificationMessage: "写入前已登记重放校验信息",
        }));
      }

      if (autoApplied) {
        setApplyStatus({
          state: "writing",
          message: `${toolLabel} 正在写入 Word 文档...`,
        });
      }
      result = await resolveCommittedTransactionResult(await executeSingleToolCall(callToExecute));

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

      if (result.success && autoApplied) {
        pushUnique(autoAppliedToolLabels, toolLabel);
        const transactionId = (result.result && typeof result.result === "object"
          ? (result.result as { transactionId?: unknown }).transactionId
          : undefined);
        if (typeof transactionId === "string" && transactionId.trim()) {
          appendPendingAgentTransaction(transactionId, call.id);
        }
      }
      if (!result.success) {
        pushUnique(failedToolLabels, toolLabel);
        if (typeof result.error === "string" && result.error.includes("unknown_commit_state:")) {
          setApplyStatus({
            state: "error",
            message: result.error,
            actions: buildUnknownCommitActions(result.error),
          });
        }
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
      setApplyStatus({
        state: "success",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}`,
      });
      return collectedResults;
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length > 0) {
      setApplyStatus({
        state: "warning",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}；但以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
      return collectedResults;
    }

    if (failedToolLabels.length > 0) {
      setApplyStatus({
        state: "error",
        message: `以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
    }
    return collectedResults;
}
