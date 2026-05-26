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
import { safeGetDocumentText } from "./documentRuntime";
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
): (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]> {
  return async (toolCalls, writtenSegments) => {
    runMetrics.toolCalls += toolCalls.length;
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

    return results;
  };
}

/**
 * Main multi-agent pipeline:
 * Planner -> Writer(Parallel Draft/Sequential Tool Write) -> Finalize.
 */
export async function runMultiAgentPipeline(
  userRequirement: string,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  const runtimeOptions = getRuntimeAgentOptions();
  const documentContext = await safeGetDocumentText();
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

  const state: PipelineRuntimeState = {
    runId: resumedRunId,
    request: userRequirement,
    outline: canResume ? (checkpoint!.checkpoint.outline as ArticleOutline) : null,
    documentContext,
    memory: null,
    writtenSections: canResume ? normalizeWrittenSections(checkpoint?.checkpoint.writtenSections) : [],
    writtenContentSegments: [],
    runMetrics: null,
    reviewCycleCount: canResume ? checkpoint!.checkpoint.loopCount : 0,
    maxReviewCycles: 3,
    shouldStop: false,
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
    const startNodeId: AgentNodeId = canResume
      ? (checkpointNodeId === "review_cycle" ? "finalize" : checkpointNodeId)
      : "planning";
    const nodes: TaskGraphNode<PipelineRuntimeState, AgentNodeId>[] = [
      {
        id: "planning",
        enterEvent: () => agentNodeEnterEvent("planning"),
        run: async (runtimeState) => {
          callbacks.onPhaseChange("planning", "正在分析需求并生成文章大纲...");
          const outline = await generateOutline(
            runtimeState.request,
            runtimeState.documentContext,
            runtimeOptions.planner,
          );
          runtimeState.outline = outline;
          runtimeState.runMetrics = createRunMetricsDraft(outline.sections.length, runtimeState.runId);
          runtimeState.currentNodeId = "planning";
          await saveCheckpoint("planning", { type: "start", nodeId: "planning" });
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
          callbacks.onPhaseChange("awaiting_confirmation", "请确认文章大纲");
          applyRunEvent({ type: "await_confirmation" });
          const confirmed = await callbacks.onOutlineReady(runtimeState.outline);
          if (!confirmed) {
            runtimeState.shouldStop = true;
            callbacks.onPhaseChange("idle", "已取消");
            await saveCheckpoint("awaiting_confirmation", { type: "cancel", nodeId: "awaiting_confirmation" });
            return;
          }
          await saveCheckpoint("awaiting_confirmation", { type: "confirm" });
        },
        next: (runtimeState) => (runtimeState.shouldStop ? null : "init_memory"),
      },
      {
        id: "init_memory",
        enterEvent: () => agentNodeEnterEvent("init_memory"),
        run: async (runtimeState) => {
          if (!runtimeState.outline) {
            throw new Error("初始化记忆失败：缺少大纲");
          }
          runtimeState.currentNodeId = "init_memory";
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
          const executeToolCalls = createTrackedToolExecutor(callbacks, runtimeState.runMetrics);
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
              onSectionPersisted,
            });
          }
          await saveCheckpoint("writing_sections");
        },
        next: () => "finalize",
      },
      {
        id: "finalize",
        enterEvent: () => agentNodeEnterEvent("finalize"),
        run: async (runtimeState) => {
          if (!runtimeState.runMetrics) return;
          runtimeState.currentNodeId = "finalize";
          const finalizedMetrics = finalizeRunMetrics(runtimeState.runMetrics);
          const metricsHistory = appendPipelineMetrics(finalizedMetrics);
          callbacks.addChatMessage(
            buildPipelineMetricsDashboard(finalizedMetrics, metricsHistory),
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
    await executeFlow();
  } catch (error) {
    if (!callbacks.isRunCancelled()) {
      if (error instanceof TaskGraphNodeNotFoundError || error instanceof TaskGraphMaxVisitsExceededError) {
        callbacks.addChatMessage(
          `流程引擎异常：${error.message}`,
          { uiOnly: true },
        );
      }
      await saveCheckpoint("error", { type: "fail", nodeId: "error" });
    }
    throw error;
  }
}
