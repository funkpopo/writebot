import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import {
  clearAgentCheckpoint,
  loadAgentCheckpoint,
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
import { readDocumentText } from "./documentRuntime";
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

function createTrackedToolExecutor(
  callbacks: OrchestratorCallbacks,
  runMetrics: RunMetricsDraft,
  harness: AgentHarnessRuntime,
): (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]> {
  return async (toolCalls, writtenSegments) => {
    runMetrics.toolCalls += toolCalls.length;
    const traceEvent = harness.recordToolBatchStart(toolCalls);
    const results = await callbacks.executeToolCalls(toolCalls, writtenSegments);

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

    harness.recordToolBatchComplete(traceEvent, results);
    const failedResults = results.filter((result) => !result.success);
    if (failedResults.length > 0) {
      harness.completeEvent(traceEvent, {
        kind: "tool_batch_failed",
        metadata: {
          failedTools: failedResults.map((result) => ({
            id: result.id,
            name: result.name,
            error: result.error || "工具执行失败",
          })),
        },
      });
      throw new AgentHarnessError(
        "tool_batch_failed",
        `工具批次执行失败：${failedResults.map((result) => result.name).join("、")}`,
        {
          agentId: "writer",
          details: {
            failedTools: failedResults.map((result) => ({
              id: result.id,
              name: result.name,
              error: result.error || "工具执行失败",
            })),
          },
        },
      );
    }

    return results;
  };
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
  const canResume = checkpoint
    && checkpoint.checkpoint.request === userRequirement
    && checkpoint.checkpoint.status === "running"
    && isArticleOutline(checkpoint.checkpoint.outline);
  const resumedRunId = canResume
    ? checkpoint.checkpoint.runId
    : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const checkpointNodeId = canResume
    ? normalizeAgentNodeId(checkpoint!.checkpoint.nodeId, "planning")
    : "planning";
  const trace = createAgentRunTrace(resumedRunId, userRequirement);
  const harness = new AgentHarnessRuntime(trace);

  const state: PipelineRuntimeState = {
    runId: resumedRunId,
    request: userRequirement,
    trace,
    outline: canResume ? (checkpoint!.checkpoint.outline as ArticleOutline) : null,
    documentContext: "",
    memory: null,
    writtenSections: canResume ? normalizeWrittenSections(checkpoint?.checkpoint.writtenSections) : [],
    writtenContentSegments: [],
    runMetrics: null,
    reviewCycleCount: canResume ? checkpoint!.checkpoint.loopCount : 0,
    maxReviewCycles: 3,
    completed: false,
    runState: canResume
      ? checkpoint.checkpoint.runState
        ?? checkpointStatusToRunState(checkpoint.checkpoint.status, checkpointNodeId)
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
    event: AgentRunEvent = { type: "enter_node", nodeId },
  ): Promise<void> => {
    state.currentNodeId = nodeId;
    await persistPipelineCheckpoint(nodeId, applyRunEvent(event), state);
  };

  const onSectionPersisted = async (): Promise<void> => {
    await saveCheckpoint("writing_sections");
  };

  const executeFlow = async (): Promise<void> => {
    const startNodeId: AgentNodeId = canResume ? checkpointNodeId : "planning";
    const nodes: TaskGraphNode<PipelineRuntimeState, AgentNodeId>[] = [
      {
        id: "planning",
        enterEvent: () => agentNodeEnterEvent("planning"),
        run: async (runtimeState) => {
          runtimeState.currentNodeId = "planning";
          harness.recordPhase("planning", "正在分析需求并生成文章大纲...");
          callbacks.onPhaseChange("planning", "正在分析需求并生成文章大纲...");
          const outline = await generateOutline(
            runtimeState.request,
            runtimeState.documentContext,
            harness,
            runtimeOptions.planner,
          );
          runtimeState.outline = outline;
          runtimeState.runMetrics = createRunMetricsDraft(outline.sections.length, runtimeState.runId);
          await saveCheckpoint("planning", startOrEnterEvent(runtimeState.runState, "planning"));
        },
        next: () => "awaiting_confirmation",
      },
      {
        id: "awaiting_confirmation",
        enterEvent: () => agentNodeEnterEvent("awaiting_confirmation"),
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
              runtimeState.documentContext,
            );
            await hydrateLongTermMemoryFromPersistence(runtimeState.memory, callbacks);
            if (canResume && checkpoint?.memorySnapshot && typeof checkpoint.memorySnapshot === "object") {
              mergeLongTermMemory(runtimeState.memory, checkpoint.memorySnapshot as Partial<LongTermMemoryState>);
            }
            await persistLongTermMemory(runtimeState.memory);
          }
          if (!runtimeState.runMetrics) {
            runtimeState.runMetrics = createRunMetricsDraft(runtimeState.outline.sections.length, runtimeState.runId);
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
          const executeToolCalls = createTrackedToolExecutor(callbacks, runtimeState.runMetrics, harness);
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
          const executeToolCalls = createTrackedToolExecutor(callbacks, runtimeState.runMetrics, harness);
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
            throw new AgentHarnessError(
              "quality_gate_failed",
              `质量门控未通过：${outcome.reasons.join("、") || "未满足审阅/事实核验要求"}`,
              {
                details: {
                  needsReplan: outcome.needsReplan,
                  reasons: outcome.reasons,
                  finalReviewScore: runtimeState.runMetrics.finalReviewScore,
                },
              },
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
          callbacks.onPhaseChange("completed", "文章撰写完成");
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
    );
  };

  try {
    state.documentContext = await readDocumentText(harness, { phase: "bootstrap" });
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
