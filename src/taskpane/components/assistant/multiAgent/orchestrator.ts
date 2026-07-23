import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { EditTransaction } from "../../../../utils/editTransactionTypes";
import { editTransactionService } from "../../../../utils/editTransactionService";
import type { DocumentIndexRangePatch } from "../../../../utils/wordApi";
import {
  clearAgentCheckpoint,
  loadAgentCheckpoint,
  type AgentCheckpointFile,
} from "../../../../utils/storageService";
import {
  checkpointStatusToRunState,
  createTrackedAgentRunState,
  normalizeAgentNodeId,
  type AgentNodeId,
  type AgentRunEvent,
  type AgentRunState,
} from "../../../../utils/agentRunState";
import {
  hydrateLongTermMemoryFromPersistence,
  isArticleOutline,
  normalizeWrittenSections,
  persistLongTermMemory,
  persistPipelineCheckpoint,
} from "./checkpointRuntime";
import {
  AgentHarnessError,
  AgentHarnessRuntime,
  buildAgentTraceSummary,
  createAgentRunTrace,
} from "./agentHarness";
import { initializeDocumentSession } from "./documentRuntime";
import { renderDocumentIndexSummary, type DocumentSession } from "./documentSession";
import {
  createLongTermMemory,
  mergeLongTermMemory,
  type LongTermMemoryState,
} from "./longTermMemory";
import {
  appendPipelineMetrics,
  buildPipelineMetricsDashboard,
} from "./pipelineMetrics";
import { generateOutline } from "./plannerAgent";
import {
  createPromptIntakeContract,
  validatePromptIntakeContract,
  type PromptIntakeContract,
} from "./promptIntake";
import {
  getRuntimeAgentOptions,
} from "./runtimeOptions";
import {
  createRunMetricsDraft,
  finalizeRunMetrics,
  type PipelineRuntimeState,
  type RunMetricsDraft,
} from "./runtimeTypes";
import {
  runParallelDraftAndWrite,
  runSequentialSectionFlow,
} from "./sectionWriteFlow";
import { runGlobalReviewAndRevision } from "./qualityGate";
import {
  agentNodeEnterEvent,
  runTaskGraph,
  TaskGraphMaxVisitsExceededError,
  TaskGraphNodeNotFoundError,
  type TaskGraphNode,
} from "./taskGraph";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
} from "./types";

type CheckpointResumeMismatchReason =
  | "raw_prompt_mismatch"
  | "contract_hash_missing"
  | "contract_hash_mismatch"
  | "outline_invalid";

export interface CheckpointResumeDecision {
  canResume: boolean;
  mismatchReason?: CheckpointResumeMismatchReason;
}

export function evaluateCheckpointResume(
  checkpoint: AgentCheckpointFile | null,
  promptContract: PromptIntakeContract,
  promptContractHash: string,
): CheckpointResumeDecision {
  if (!checkpoint || checkpoint.checkpoint.status !== "running") {
    return { canResume: false };
  }

  if (checkpoint.checkpoint.request !== promptContract.rawPrompt) {
    return { canResume: false, mismatchReason: "raw_prompt_mismatch" };
  }

  if (!checkpoint.checkpoint.promptContractHash) {
    return { canResume: false, mismatchReason: "contract_hash_missing" };
  }

  if (checkpoint.checkpoint.promptContractHash !== promptContractHash) {
    return { canResume: false, mismatchReason: "contract_hash_mismatch" };
  }

  if (!isArticleOutline(checkpoint.checkpoint.outline)) {
    return { canResume: false, mismatchReason: "outline_invalid" };
  }

  return { canResume: true };
}

function buildFinalWrittenContent(outline: ArticleOutline | null, writtenSections: Array<{ sectionId: string; content: string }>): string {
  if (writtenSections.length === 0) return "";
  const bySectionId = new Map(writtenSections.map((section) => [section.sectionId, section.content.trim()]));
  const ordered = outline?.sections.length
    ? outline.sections
      .map((section) => bySectionId.get(section.id) || "")
      .filter((content) => content.trim().length > 0)
    : writtenSections.map((section) => section.content.trim()).filter(Boolean);
  return ordered.join("\n\n").trim();
}

function assertPromptContractSupportedForCurrentPipeline(contract: PromptIntakeContract): void {
  if (contract.taskType === "create_article") return;

  throw new AgentHarnessError(
    "prompt_contract_invalid",
    `当前 Agent 写作流程仅放行 create_article；${contract.taskType} 需要明确的 index/range 驱动入口，已阻断以避免按新文章默认生成。请改用“写一篇/生成一篇”新文章任务，或在局部 range 修订入口接入后再执行此类文档依赖任务。`,
    {
      details: {
        taskType: contract.taskType,
        documentDependency: contract.documentDependency,
        primaryGoal: contract.primaryGoal,
      },
    },
  );
}

const FORBIDDEN_AGENT_READ_TOOL_NAMES = new Set([
  "get_document_text",
  "get_paragraphs",
  "get_paragraph_by_index",
  "get_document_structure",
]);

const SESSION_READ_TOOL_NAMES = new Set([
  "get_document_index",
  "read_document_ranges",
  "read_nearby_context",
  "search_document",
]);

const STRUCTURED_WRITE_TOOL_NAMES = new Set([
  "insert_at_anchor",
  "replace_paragraph_range",
  "rewrite_paragraph",
  "delete_paragraph_range",
]);

const WRITER_ALLOWED_TOOL_NAMES = new Set([
  ...Array.from(SESSION_READ_TOOL_NAMES),
  ...Array.from(STRUCTURED_WRITE_TOOL_NAMES),
]);

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "是"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "否"].includes(normalized)) return false;
  }
  return undefined;
}

function parseIndices(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => toNumber(item)).filter((item): item is number => item !== undefined);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，\s]+/)
      .map((item) => toNumber(item))
      .filter((item): item is number => item !== undefined);
  }
  const single = toNumber(value);
  return single === undefined ? [] : [single];
}

function hasVerifiableExpectedBefore(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expectedBefore = record.expectedBefore;
  if (!expectedBefore || typeof expectedBefore !== "object" || Array.isArray(expectedBefore)) return false;
  const expected = expectedBefore as Record<string, unknown>;
  const anchor = expected.anchor && typeof expected.anchor === "object" && !Array.isArray(expected.anchor)
    ? expected.anchor as Record<string, unknown>
    : undefined;
  const paragraphIndex = toNumber(expected.paragraphIndex) ?? toNumber(anchor?.paragraphIndex);
  if (paragraphIndex === undefined) return false;

  return [
    expected.expectedTextHash,
    expected.expectedTextExcerpt,
    expected.paragraphTextHash,
    expected.beforeTextHash,
    anchor?.paragraphTextHash,
    anchor?.normalizedExcerpt,
  ].some((item) => typeof item === "string" && item.trim().length > 0);
}

function extractTransactionId(result: ToolCallResult): string | null {
  if (!result.result || typeof result.result !== "object") return null;
  const transactionId = (result.result as { transactionId?: unknown }).transactionId;
  return typeof transactionId === "string" && transactionId.trim()
    ? transactionId.trim()
    : null;
}

function buildDocumentIndexPatchFromTransaction(transaction: EditTransaction): DocumentIndexRangePatch {
  const paragraphCountAfter = transaction.after?.paragraphCount;
  if (typeof paragraphCountAfter !== "number") {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `事务 ${transaction.id} 缺少写入后段落计数，无法局部刷新 DocumentSession。`,
      { details: { transactionId: transaction.id, operationType: transaction.operation.type } },
    );
  }

  switch (transaction.operation.type) {
    case "insert_at_anchor": {
      const anchorIndex = transaction.before?.startParagraphIndex;
      const afterStart = transaction.after?.startParagraphIndex;
      const afterEnd = transaction.after?.endParagraphIndex;
      if (
        typeof anchorIndex !== "number"
        || typeof afterStart !== "number"
        || typeof afterEnd !== "number"
      ) {
        throw new AgentHarnessError(
          "document_range_unresolved",
          `事务 ${transaction.id} 缺少 insert_at_anchor 的 before/after range。`,
          { details: { transactionId: transaction.id, before: transaction.before, after: transaction.after } },
        );
      }
      return {
        beforeRange: { start: anchorIndex + 1, end: anchorIndex },
        afterRange: { start: afterStart, end: afterEnd },
        paragraphCountAfter,
      };
    }
    case "replace_paragraph_range":
    case "rewrite_paragraph": {
      if (transaction.scope.kind !== "paragraph_range") {
        throw new AgentHarnessError(
          "document_range_unresolved",
          `事务 ${transaction.id} 缺少 paragraph_range scope。`,
          { details: { transactionId: transaction.id, scope: transaction.scope } },
        );
      }
      const afterStart = transaction.after?.startParagraphIndex;
      const afterEnd = transaction.after?.endParagraphIndex;
      if (typeof afterStart !== "number" || typeof afterEnd !== "number") {
        throw new AgentHarnessError(
          "document_range_unresolved",
          `事务 ${transaction.id} 缺少替换后的 after range。`,
          { details: { transactionId: transaction.id, after: transaction.after } },
        );
      }
      return {
        beforeRange: {
          start: transaction.scope.startParagraphIndex,
          end: transaction.scope.endParagraphIndex,
        },
        afterRange: { start: afterStart, end: afterEnd },
        paragraphCountAfter,
      };
    }
    case "delete_paragraph_range": {
      if (transaction.scope.kind !== "paragraph_range") {
        throw new AgentHarnessError(
          "document_range_unresolved",
          `事务 ${transaction.id} 缺少 paragraph_range scope。`,
          { details: { transactionId: transaction.id, scope: transaction.scope } },
        );
      }
      return {
        beforeRange: {
          start: transaction.scope.startParagraphIndex,
          end: transaction.scope.endParagraphIndex,
        },
        paragraphCountAfter,
      };
    }
    default:
      throw new AgentHarnessError(
        "tool_contract_violation",
        `Agent writer 不支持事务操作 ${transaction.operation.type} 的 session patch。`,
        { details: { transactionId: transaction.id, operationType: transaction.operation.type } },
      );
  }
}

function isNoopStructuredWriteResult(result: ToolCallResult): boolean {
  const text = typeof result.result === "string" ? result.result : "";
  return text.includes("跳过");
}

async function resolveIndexPatchFromWriteResult(
  result: ToolCallResult,
): Promise<{ transactionId: string; patch: DocumentIndexRangePatch } | null> {
  const transactionId = extractTransactionId(result);
  if (!transactionId) {
    if (isNoopStructuredWriteResult(result)) {
      return null;
    }
    throw new AgentHarnessError(
      "document_range_unresolved",
      "结构化写入成功但缺少 transaction ledger，无法局部刷新 DocumentSession。",
      {
        details: {
          toolResult: {
            id: result.id,
            name: result.name,
            success: result.success,
          },
        },
      },
    );
  }

  const transaction = await editTransactionService.loadTransaction(transactionId);
  if (!transaction) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `未找到结构化写入事务 ${transactionId}，无法局部刷新 DocumentSession。`,
      { details: { transactionId, toolResultId: result.id, toolName: result.name } },
    );
  }

  return {
    transactionId,
    patch: buildDocumentIndexPatchFromTransaction(transaction),
  };
}

async function refreshDocumentSessionAfterStructuredWrite(
  result: ToolCallResult,
  documentSession: DocumentSession,
  harness: AgentHarnessRuntime,
  runMetrics: RunMetricsDraft,
): Promise<void> {
  const resolved = await resolveIndexPatchFromWriteResult(result);
  if (!resolved) return;
  await documentSession.refresh(
    harness,
    `tool_write:${resolved.transactionId}`,
    resolved.patch,
  );
  runMetrics.documentIndexBuildCount += 1;
}

function getToolBatchFailureCode(failedResults: ToolCallResult[]): AgentHarnessError["code"] {
  if (failedResults.some((result) => FORBIDDEN_AGENT_READ_TOOL_NAMES.has(result.name))) {
    return "forbidden_full_document_read";
  }
  if (failedResults.some((result) =>
    !WRITER_ALLOWED_TOOL_NAMES.has(result.name)
    || (STRUCTURED_WRITE_TOOL_NAMES.has(result.name) && result.error?.includes("expectedBefore"))
  )) {
    return "tool_contract_violation";
  }
  if (failedResults.some((result) => result.error?.includes("DocumentSession") || result.error?.includes("范围"))) {
    return "document_range_unresolved";
  }
  return "tool_batch_failed";
}

async function executeDocumentSessionTool(
  call: ToolCallRequest,
  documentSession: DocumentSession,
  harness: AgentHarnessRuntime,
  runMetrics: RunMetricsDraft,
): Promise<ToolCallResult> {
  try {
    const args = call.arguments || {};
    switch (call.name) {
      case "get_document_index":
        return { id: call.id, name: call.name, success: true, result: documentSession.getIndex() };
      case "read_document_ranges": {
        const ranges = Array.isArray(args.ranges)
          ? args.ranges.map((item) => {
            const record = (item || {}) as Record<string, unknown>;
            return {
              start: toNumber(record.start) ?? 0,
              end: toNumber(record.end),
            };
          })
          : undefined;
        const headingPath = Array.isArray(args.headingPath)
          ? args.headingPath.map((item) => String(item))
          : undefined;
        const searchResultIds = Array.isArray(args.searchResultIds)
          ? args.searchResultIds.map((item) => String(item))
          : undefined;
        runMetrics.rangeReadCount += 1;
        const result = await documentSession.readRanges(
          harness,
          {
            ranges,
            paragraphIndices: parseIndices(args.paragraphIndices),
            headingPath,
            searchResultIds,
            maxParagraphs: toNumber(args.maxParagraphs),
          },
          { toolCallId: call.id, toolName: call.name },
        );
        return { id: call.id, name: call.name, success: true, result };
      }
      case "read_nearby_context": {
        runMetrics.rangeReadCount += 1;
        const result = await documentSession.readNearbyContext(
          harness,
          {
            paragraphIndex: toNumber(args.paragraphIndex),
            anchor: args.anchor && typeof args.anchor === "object"
              ? args.anchor as { paragraphIndex?: number }
              : undefined,
            searchResultId: typeof args.searchResultId === "string" ? args.searchResultId : undefined,
            before: toNumber(args.before),
            after: toNumber(args.after),
          },
          { toolCallId: call.id, toolName: call.name },
        );
        return { id: call.id, name: call.name, success: true, result };
      }
      case "search_document": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          throw new AgentHarnessError(
            "document_range_unresolved",
            "search_document 需要 query 参数",
            { details: { toolCallId: call.id } },
          );
        }
        return {
          id: call.id,
          name: call.name,
          success: true,
          result: documentSession.searchIndex(query, {
            matchCase: toBoolean(args.matchCase),
            matchWholeWord: toBoolean(args.matchWholeWord),
          }),
        };
      }
      default:
        return {
          id: call.id,
          name: call.name,
          success: false,
          error: `DocumentSession 不支持工具：${call.name}`,
        };
    }
  } catch (error) {
    return {
      id: call.id,
      name: call.name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createTrackedToolExecutor(
  callbacks: OrchestratorCallbacks,
  runMetrics: RunMetricsDraft,
  harness: AgentHarnessRuntime,
  getDocumentSession: () => DocumentSession,
): (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]> {
  return async (toolCalls, writtenSegments) => {
    runMetrics.toolCalls += toolCalls.length;
    const traceEvent = harness.recordToolBatchStart(toolCalls);
    const documentSession = getDocumentSession();
    const results: ToolCallResult[] = new Array(toolCalls.length);

    for (let index = 0; index < toolCalls.length; index += 1) {
      const call = toolCalls[index];
      if (FORBIDDEN_AGENT_READ_TOOL_NAMES.has(call.name)) {
        results[index] = {
          id: call.id,
          name: call.name,
          success: false,
          error: "Agent workflow 禁止全文/全段落读取；必须使用 DocumentSession 索引与局部 range。",
        };
        continue;
      }
      if (!WRITER_ALLOWED_TOOL_NAMES.has(call.name)) {
        results[index] = {
          id: call.id,
          name: call.name,
          success: false,
          error: `Agent writer 不允许调用工具 ${call.name}；只能使用 DocumentSession 读取工具和带锚点的结构化写入工具。`,
        };
        continue;
      }
      if (SESSION_READ_TOOL_NAMES.has(call.name)) {
        results[index] = await executeDocumentSessionTool(call, documentSession, harness, runMetrics);
        continue;
      }
      if (STRUCTURED_WRITE_TOOL_NAMES.has(call.name) && !hasVerifiableExpectedBefore(call.arguments)) {
        results[index] = {
          id: call.id,
          name: call.name,
          success: false,
          error: `结构化写入工具 ${call.name} 缺少可验证 expectedBefore（paragraphIndex + anchor/hash/excerpt），已阻断。`,
        };
        continue;
      }
      const [passthroughResult] = await callbacks.executeToolCalls([call], writtenSegments);
      results[index] = passthroughResult || {
        id: call.id,
        name: call.name,
        success: false,
        error: "工具执行未返回结果",
      };
      if (STRUCTURED_WRITE_TOOL_NAMES.has(call.name) && !results[index]?.success) {
        for (let remainingIndex = index + 1; remainingIndex < toolCalls.length; remainingIndex += 1) {
          const remainingCall = toolCalls[remainingIndex];
          results[remainingIndex] = {
            id: remainingCall.id,
            name: remainingCall.name,
            success: false,
            error: "前序结构化写入失败，已阻断后续工具调用。",
          };
        }
        break;
      }
      if (STRUCTURED_WRITE_TOOL_NAMES.has(call.name) && results[index]?.success) {
        try {
          await refreshDocumentSessionAfterStructuredWrite(
            results[index],
            documentSession,
            harness,
            runMetrics,
          );
        } catch (error) {
          harness.completeEvent(traceEvent, {
            kind: "tool_batch_failed",
            metadata: {
              code: error instanceof AgentHarnessError ? error.code : "document_range_unresolved",
              failedTools: [{
                id: call.id,
                name: call.name,
                error: error instanceof Error ? error.message : String(error),
              }],
            },
          });
          throw error instanceof AgentHarnessError
            ? error
            : new AgentHarnessError(
              "document_range_unresolved",
              `结构化写入后局部刷新 DocumentSession 失败：${error instanceof Error ? error.message : String(error)}`,
              { agentId: "writer", cause: error },
            );
        }
        runMetrics.writeTransactionCount += 1;
      }
    }

    for (const result of results) {
      if (!result.success) {
        runMetrics.toolFailures += 1;
        continue;
      }
      const text = typeof result.result === "string" ? result.result : "";
      if (text.includes("跳过重复写入")) {
        runMetrics.duplicateWriteSkips += 1;
      }
    }

    const failedResults = results.filter((result) => !result.success);
    if (failedResults.length > 0) {
      const failureCode = getToolBatchFailureCode(failedResults);
      harness.recordToolBatchFailed(traceEvent, results, failureCode);
      throw new AgentHarnessError(
        failureCode,
        `工具批次执行失败：${failedResults.map((result) => result.name).join("、")}`,
        {
          agentId: "writer",
          details: {
            code: failureCode,
            failedTools: failedResults.map((result) => ({
              id: result.id,
              name: result.name,
              error: result.error || "工具执行失败",
            })),
          },
        },
      );
    }

    harness.recordToolBatchComplete(traceEvent, results);
    return results;
  };
}

function requireDocumentSession(state: PipelineRuntimeState): DocumentSession {
  if (state.documentSession) return state.documentSession;
  throw new AgentHarnessError(
    "document_index_failed",
    "DocumentSession 未初始化，无法进入 agent pipeline",
    { details: { nodeId: state.currentNodeId || "unknown" } },
  );
}

function startOrEnterEvent(state: AgentRunState, nodeId: AgentNodeId): AgentRunEvent {
  return state === "idle"
    ? { type: "start", nodeId }
    : { type: "enter_node", nodeId };
}

function isTerminalRunState(state: AgentRunState): boolean {
  return state === "completed" || state === "error" || state === "cancelled";
}

/**
 * Main multi-agent pipeline:
 * Planner -> Writer(Parallel Draft/Sequential Tool Write) -> Review/Verify/Quality Gate -> Finalize.
 */
export async function runMultiAgentPipeline(
  userRequirement: string,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  const runtimeOptions = getRuntimeAgentOptions();
  const checkpoint = await loadAgentCheckpoint();
  const bootstrapRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const trace = createAgentRunTrace(bootstrapRunId, userRequirement);
  const harness = new AgentHarnessRuntime(trace);

  let promptContract: PromptIntakeContract;
  let promptContractHash: string;
  let intakePath: "rule" | "llm" = "llm";
  let intakeMs = 0;
  try {
    const result = await createPromptIntakeContract(
      userRequirement,
      harness,
      runtimeOptions.planner,
      callbacks.onChunk,
    );
    promptContract = result.contract;
    promptContractHash = result.contractHash;
    intakePath = result.intakePath;
    intakeMs = result.intakeMs;
  } catch (error) {
    harness.failRun(error);
    callbacks.onPhaseChange("error", error instanceof Error ? error.message : "Prompt Intake Contract 创建失败");
    callbacks.addChatMessage(
      buildAgentTraceSummary(harness.getTrace()),
      { uiOnly: true },
    );
    throw error;
  }

  const resumeDecision = evaluateCheckpointResume(checkpoint, promptContract, promptContractHash);
  const canResume = resumeDecision.canResume;
  const resumedRunId = canResume ? checkpoint!.checkpoint.runId : bootstrapRunId;
  const checkpointNodeId = canResume
    ? normalizeAgentNodeId(checkpoint!.checkpoint.nodeId, "planning")
    : "planning";

  if (checkpoint?.checkpoint.status === "running" && resumeDecision.mismatchReason) {
    harness.recordEvent({
      kind: "checkpoint_contract_mismatch",
      message: "检测到 checkpoint 与本轮 Prompt Contract 不一致，已拒绝恢复旧运行",
      metadata: {
        reason: resumeDecision.mismatchReason,
        checkpointRunId: checkpoint.checkpoint.runId,
        checkpointPromptContractHash: checkpoint.checkpoint.promptContractHash,
        currentPromptContractHash: promptContractHash,
      },
    });
    callbacks.addChatMessage(
      `检测到旧 checkpoint 与本轮需求不一致（${resumeDecision.mismatchReason}），已拒绝恢复旧运行并启动新的 Agent 运行。`,
      { uiOnly: true },
    );
  }

  try {
    validatePromptIntakeContract(promptContract);
    assertPromptContractSupportedForCurrentPipeline(promptContract);
  } catch (error) {
    harness.recordEvent({
      kind: "prompt_contract_failed",
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        taskType: promptContract.taskType,
        documentDependency: promptContract.documentDependency,
        missingCriticalInputs: promptContract.missingCriticalInputs,
        contractHash: promptContractHash,
        code: error instanceof AgentHarnessError ? error.code : undefined,
      },
    });
    harness.failRun(error);
    callbacks.onPhaseChange("error", error instanceof Error ? error.message : "Prompt Intake Contract 校验失败");
    callbacks.addChatMessage(
      buildAgentTraceSummary(harness.getTrace()),
      { uiOnly: true },
    );
    throw error;
  }

  const state: PipelineRuntimeState = {
    runId: resumedRunId,
    request: userRequirement,
    promptContract,
    promptContractHash,
    intakePath,
    intakeMs,
    trace,
    outline: canResume ? (checkpoint!.checkpoint.outline as ArticleOutline) : null,
    documentSession: null,
    memory: null,
    writtenSections: canResume ? normalizeWrittenSections(checkpoint?.checkpoint.writtenSections) : [],
    writtenContentSegments: [],
    runMetrics: null,
    reviewCycleCount: canResume ? checkpoint!.checkpoint.loopCount : 0,
    maxReviewCycles: 3,
    completed: false,
    runState: canResume
      ? checkpoint!.checkpoint.runState
        ?? checkpointStatusToRunState(checkpoint!.checkpoint.status, checkpointNodeId)
      : "idle",
    currentNodeId: canResume ? checkpointNodeId : null,
  };

  state.writtenContentSegments.push(
    ...state.writtenSections.map((item) => item.content.trim()).filter(Boolean),
  );

  if (canResume) {
    callbacks.addChatMessage(
      `检测到可恢复运行：${state.runId}，从节点 ${checkpoint!.checkpoint.nodeId} 继续。`,
      { uiOnly: true },
    );
  }

  const trackedRunState = createTrackedAgentRunState(state.runState);

  const applyRunEvent = (event: AgentRunEvent): AgentRunState => {
    state.runState = trackedRunState.transition(event);
    return state.runState;
  };

  const saveCheckpoint = async (
    nodeId: AgentNodeId,
    event?: AgentRunEvent,
  ): Promise<void> => {
    state.currentNodeId = nodeId;
    if (event) {
      applyRunEvent(event);
    }
    await persistPipelineCheckpoint(nodeId, state.runState, state);
  };

  const onSectionPersisted = async (): Promise<void> => {
    await saveCheckpoint("writing_sections");
  };

  const executeFlow = async (): Promise<void> => {
    const startNodeId: AgentNodeId = canResume ? checkpointNodeId : "planning";
    const nodes: TaskGraphNode<PipelineRuntimeState, AgentNodeId>[] = [
      {
        id: "planning",
        enterEvent: (_nodeId, runtimeState) => startOrEnterEvent(runtimeState.runState, "planning"),
        run: async (runtimeState) => {
          runtimeState.currentNodeId = "planning";
          harness.recordPhase("planning", "正在分析需求并生成文章大纲...");
          callbacks.onPhaseChange("planning", "正在分析需求并生成文章大纲...");
          const outline = await generateOutline(
            runtimeState.promptContract,
            runtimeState.promptContractHash,
            requireDocumentSession(runtimeState).getSummary(),
            harness,
            runtimeOptions.planner,
            callbacks.onChunk,
          );
          runtimeState.outline = outline;
          runtimeState.runMetrics = createRunMetricsDraft(outline.sections.length, runtimeState.runId, {
            intakePath: runtimeState.intakePath,
            intakeMs: runtimeState.intakeMs,
          });
          runtimeState.runMetrics.documentIndexBuildCount = 1;
          await saveCheckpoint("planning");
        },
        next: () => "awaiting_confirmation",
      },
      {
        id: "awaiting_confirmation",
        enterEvent: (_nodeId, runtimeState) =>
          runtimeState.runState === "awaiting_confirmation"
            ? null
            : agentNodeEnterEvent("awaiting_confirmation"),
        run: async (runtimeState) => {
          if (!runtimeState.outline) {
            throw new Error("缺少可确认的大纲");
          }
          runtimeState.currentNodeId = "awaiting_confirmation";
          harness.recordPhase("awaiting_confirmation", "请确认文章大纲");
          callbacks.onPhaseChange("awaiting_confirmation", "请确认文章大纲");
          if (runtimeState.runState !== "awaiting_confirmation") {
            applyRunEvent({ type: "await_confirmation" });
          }
          const confirmed = await callbacks.onOutlineReady(runtimeState.outline);
          if (!confirmed) {
            callbacks.onPhaseChange("idle", "已取消");
            await saveCheckpoint("awaiting_confirmation", { type: "cancel", nodeId: "awaiting_confirmation" });
            throw new AgentHarnessError(
              "cancelled",
              "用户未确认文章大纲，Agent 运行已取消",
              { details: { nodeId: "awaiting_confirmation" } },
            );
          }
          await saveCheckpoint("awaiting_confirmation", { type: "confirm" });
        },
        next: () => "init_memory",
      },
      {
        id: "init_memory",
        enterEvent: () => agentNodeEnterEvent("init_memory"),
        run: async (runtimeState) => {
          if (!runtimeState.outline) {
            throw new Error("初始化记忆失败：缺少大纲");
          }
          runtimeState.currentNodeId = "init_memory";
          harness.recordPhase("init_memory", "正在初始化长期记忆");
          if (!runtimeState.memory) {
            runtimeState.memory = createLongTermMemory(
              runtimeState.outline,
              runtimeState.request,
              renderDocumentIndexSummary(requireDocumentSession(runtimeState).getSummary()),
            );
            await hydrateLongTermMemoryFromPersistence(runtimeState.memory, callbacks);
            if (canResume && checkpoint?.memorySnapshot && typeof checkpoint.memorySnapshot === "object") {
              mergeLongTermMemory(runtimeState.memory, checkpoint.memorySnapshot as Partial<LongTermMemoryState>);
            }
            await persistLongTermMemory(runtimeState.memory);
          }
          if (!runtimeState.runMetrics) {
            runtimeState.runMetrics = createRunMetricsDraft(runtimeState.outline.sections.length, runtimeState.runId, {
              intakePath: runtimeState.intakePath,
              intakeMs: runtimeState.intakeMs,
            });
          }
          await saveCheckpoint("init_memory");
        },
        next: () => "writing_sections",
      },
      {
        id: "writing_sections",
        enterEvent: () => agentNodeEnterEvent("writing_sections"),
        run: async (runtimeState) => {
          if (!runtimeState.outline || !runtimeState.memory || !runtimeState.runMetrics) {
            throw new Error("写作阶段状态不完整");
          }
          runtimeState.currentNodeId = "writing_sections";
          harness.recordPhase("writing", "正在撰写并写入章节");
          const documentSession = requireDocumentSession(runtimeState);
          const executeToolCalls = createTrackedToolExecutor(
            callbacks,
            runtimeState.runMetrics,
            harness,
            () => requireDocumentSession(runtimeState),
          );
          const completedSectionIds = new Set(runtimeState.writtenSections.map((item) => item.sectionId));
          if (runtimeState.outline.sections.length > 1) {
            await runParallelDraftAndWrite({
              outline: runtimeState.outline,
              callbacks,
              writtenSections: runtimeState.writtenSections,
              completedSectionIds,
              memory: runtimeState.memory,
              executeToolCalls,
              writtenContentSegments: runtimeState.writtenContentSegments,
              runtimeOptions,
              harness,
              documentSession,
              runMetrics: runtimeState.runMetrics,
              onSectionPersisted,
            });
          } else {
            await runSequentialSectionFlow({
              outline: runtimeState.outline,
              callbacks,
              writtenSections: runtimeState.writtenSections,
              completedSectionIds,
              memory: runtimeState.memory,
              executeToolCalls,
              writtenContentSegments: runtimeState.writtenContentSegments,
              runtimeOptions,
              harness,
              documentSession,
              runMetrics: runtimeState.runMetrics,
              onSectionPersisted,
            });
          }
          await saveCheckpoint("writing_sections");
        },
        next: () => "review_cycle",
      },
      {
        id: "review_cycle",
        enterEvent: () => agentNodeEnterEvent("review_cycle"),
        run: async (runtimeState) => {
          if (!runtimeState.outline || !runtimeState.memory || !runtimeState.runMetrics) {
            throw new AgentHarnessError(
              "state_contract_violation",
              "质量门控阶段状态不完整",
              { details: { nodeId: "review_cycle" } },
            );
          }
          runtimeState.currentNodeId = "review_cycle";
          harness.recordPhase("reviewing", "正在执行质量门控");
          const documentSession = requireDocumentSession(runtimeState);
          const executeToolCalls = createTrackedToolExecutor(
            callbacks,
            runtimeState.runMetrics,
            harness,
            () => requireDocumentSession(runtimeState),
          );
          const outcome = await runGlobalReviewAndRevision({
            outline: runtimeState.outline,
            callbacks,
            writtenSections: runtimeState.writtenSections,
            memory: runtimeState.memory,
            executeToolCalls,
            runMetrics: runtimeState.runMetrics,
            writtenContentSegments: runtimeState.writtenContentSegments,
            runtimeOptions,
            harness,
            documentSession,
          });
          runtimeState.reviewCycleCount += 1;
          harness.recordQualityGate({
            passed: outcome.qualityGatePassed,
            needsReplan: outcome.needsReplan,
            reasons: outcome.reasons,
            finalReviewScore: runtimeState.runMetrics.finalReviewScore,
          });
          callbacks.onReviewCycleComplete?.(outcome);
          await saveCheckpoint("review_cycle");
          if (!outcome.qualityGatePassed) {
            // 正文与修订都已提交进 Word 文档；此处报错只会让一次实际完成的
            // 运行以失败收场，且重跑会撞上重复写入守卫。改为完成 + 警告。
            callbacks.addChatMessage(
              `质量门控未通过（${outcome.reasons.join("、") || "审阅评分低于 4 分"}）。`
              + "文章内容已写入文档，建议人工复核重点章节后按需修改。",
              { uiOnly: true },
            );
          }
        },
        next: () => "finalize",
      },
      {
        id: "finalize",
        enterEvent: () => agentNodeEnterEvent("finalize"),
        run: async (runtimeState) => {
          if (!runtimeState.runMetrics) return;
          runtimeState.currentNodeId = "finalize";
          harness.completeRun();
          const finalWrittenContent = buildFinalWrittenContent(runtimeState.outline, runtimeState.writtenSections);
          if (finalWrittenContent) {
            callbacks.onDocumentSnapshot(finalWrittenContent, "最终正文");
          }
          const finalizedMetrics = finalizeRunMetrics(runtimeState.runMetrics);
          const metricsHistory = appendPipelineMetrics(finalizedMetrics);
          callbacks.addChatMessage(
            buildPipelineMetricsDashboard(finalizedMetrics, metricsHistory),
            { uiOnly: true },
          );
          callbacks.addChatMessage(
            buildAgentTraceSummary(harness.getTrace()),
            { uiOnly: true },
          );
          const completionMessage = runtimeState.runMetrics.qualityGatePassed === false
            ? "文章撰写完成（质量门控未通过，建议人工复核）"
            : "文章撰写完成";
          callbacks.onPhaseChange("completed", completionMessage);
          runtimeState.completed = true;
          await saveCheckpoint("finalize", { type: "complete" });
          await clearAgentCheckpoint();
        },
        next: () => null,
      },
    ];

    await runTaskGraph(
      nodes,
      startNodeId,
      state,
      callbacks.isRunCancelled,
      {
        onRunEvent: async (event, nodeId, runtimeState) => {
          runtimeState.currentNodeId = nodeId;
          applyRunEvent(event);
          harness.recordEvent({
            kind: "task_graph_node_entered",
            phase: String(nodeId),
            message: `进入节点: ${String(nodeId)}`,
            metadata: {
              runEvent: event.type,
              runState: runtimeState.runState,
            },
          });
        },
        onGraphEvent: async (event, runtimeState) => {
          if (event.type !== "completed") return;
          harness.recordEvent({
            kind: "task_graph_completed",
            phase: "task_graph",
            message: "TaskGraph completed",
            metadata: {
              runState: runtimeState.runState,
            },
          });
        },
      },
    );
  };

  try {
    state.documentSession = await initializeDocumentSession(harness, { phase: "bootstrap" });
    if (state.outline && !state.runMetrics) {
      state.runMetrics = createRunMetricsDraft(state.outline.sections.length, state.runId, {
        intakePath: state.intakePath,
        intakeMs: state.intakeMs,
      });
      state.runMetrics.documentIndexBuildCount = 1;
    }
    await executeFlow();
  } catch (error) {
    harness.failRun(error);
    if (error instanceof TaskGraphNodeNotFoundError || error instanceof TaskGraphMaxVisitsExceededError) {
      callbacks.addChatMessage(
        `流程引擎异常：${error.message}`,
        { uiOnly: true },
      );
    }

    const nodeId = error instanceof AgentHarnessError && error.code === "cancelled"
      ? state.currentNodeId || "error"
      : "error";
    const event: AgentRunEvent = error instanceof AgentHarnessError && error.code === "cancelled"
      ? { type: "cancel", nodeId: state.currentNodeId || undefined }
      : { type: "fail", nodeId: "error" };

    if (!isTerminalRunState(state.runState)) {
      if (state.runState === "idle" && (event.type === "fail" || event.type === "cancel")) {
        applyRunEvent({ type: "start", nodeId: state.currentNodeId || nodeId });
      }
      await saveCheckpoint(nodeId, event);
    } else {
      state.currentNodeId = nodeId;
      await persistPipelineCheckpoint(nodeId, state.runState, state);
    }

    callbacks.addChatMessage(
      buildAgentTraceSummary(harness.getTrace()),
      { uiOnly: true },
    );
    throw error;
  }
}
