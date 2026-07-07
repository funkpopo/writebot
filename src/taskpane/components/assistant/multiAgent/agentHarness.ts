import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";

export type AgentHarnessErrorCode =
  | "model_call_failed"
  | "structured_output_invalid"
  | "prompt_contract_invalid"
  | "checkpoint_contract_mismatch"
  | "document_index_failed"
  | "document_range_unresolved"
  | "forbidden_full_document_read"
  | "document_read_failed"
  | "tool_contract_violation"
  | "duplicate_write_detected"
  | "tool_batch_failed"
  | "quality_gate_failed"
  | "state_contract_violation"
  | "cancelled";

export class AgentHarnessError extends Error {
  readonly code: AgentHarnessErrorCode;
  readonly agentId?: AgentId;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AgentHarnessErrorCode,
    message: string,
    options?: {
      agentId?: AgentId;
      cause?: unknown;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "AgentHarnessError";
    this.code = code;
    this.agentId = options?.agentId;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

export const WRITER_TOOL_NAMES = [
  "get_document_index",
  "read_document_ranges",
  "read_nearby_context",
  "search_document",
  "insert_at_anchor",
  "replace_paragraph_range",
  "rewrite_paragraph",
  "delete_paragraph_range",
] as const;

export interface AgentSpec {
  id: string;
  role: "planner" | "writer" | "reviewer" | "critic" | "arbiter" | "verifier";
  displayName: string;
  responsibility: string;
  outputContract: string;
  allowedTools: readonly string[];
  requiresStructuredOutput: boolean;
}

export const AGENT_SPECS = {
  planner: {
    id: "planner",
    role: "planner",
    displayName: "Planner",
    responsibility: "Turn the user's requirement and current document context into a bounded article outline.",
    outputContract: "ArticleOutline JSON",
    allowedTools: [],
    requiresStructuredOutput: true,
  },
  writer: {
    id: "writer",
    role: "writer",
    displayName: "Writer",
    responsibility: "Draft and write sections into Word through guarded document tools.",
    outputContract: "Word document edits plus section snapshot text",
    allowedTools: WRITER_TOOL_NAMES,
    requiresStructuredOutput: false,
  },
  reviewer: {
    id: "reviewer",
    role: "reviewer",
    displayName: "Reviewer",
    responsibility: "Review the generated document against the outline with a balanced lens.",
    outputContract: "ReviewFeedback JSON",
    allowedTools: [],
    requiresStructuredOutput: true,
  },
  critic: {
    id: "critic",
    role: "critic",
    displayName: "Critic",
    responsibility: "Independently stress-test the document for hidden content and reasoning risks.",
    outputContract: "ReviewFeedback JSON",
    allowedTools: [],
    requiresStructuredOutput: true,
  },
  arbiter: {
    id: "arbiter",
    role: "arbiter",
    displayName: "Arbiter",
    responsibility: "Resolve reviewer disagreements into one final actionable review decision.",
    outputContract: "ReviewFeedback JSON",
    allowedTools: [],
    requiresStructuredOutput: true,
  },
  verifier: {
    id: "verifier",
    role: "verifier",
    displayName: "Verifier",
    responsibility: "Check section claims against text-local evidence and source anchors.",
    outputContract: "VerificationFeedback JSON",
    allowedTools: [],
    requiresStructuredOutput: true,
  },
} as const satisfies Record<string, AgentSpec>;

export type AgentId = keyof typeof AGENT_SPECS;

export type AgentTraceEventKind =
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "prompt_contract_created"
  | "prompt_contract_failed"
  | "checkpoint_contract_mismatch"
  | "document_index_started"
  | "document_index_completed"
  | "document_index_failed"
  | "document_range_read_started"
  | "document_range_read_completed"
  | "document_range_read_failed"
  | "task_graph_node_entered"
  | "task_graph_completed"
  | "phase_started"
  | "agent_step_started"
  | "agent_step_completed"
  | "agent_step_failed"
  | "model_call_started"
  | "model_call_completed"
  | "model_call_failed"
  | "document_read_started"
  | "document_read_completed"
  | "document_read_failed"
  | "tool_batch_started"
  | "tool_batch_completed"
  | "tool_batch_failed"
  | "quality_gate_completed";

export interface AgentTraceEvent {
  id: string;
  runId: string;
  kind: AgentTraceEventKind;
  agentId?: AgentId;
  phase?: string;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  toolNames?: string[];
  toolCount?: number;
  toolFailureCount?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRunTrace {
  runId: string;
  request: string;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  events: AgentTraceEvent[];
}

let nextTraceEventId = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function nextEventId(runId: string): string {
  nextTraceEventId += 1;
  return `${runId}_evt_${nextTraceEventId.toString(36)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentRunTrace(runId: string, request: string): AgentRunTrace {
  return {
    runId,
    request,
    startedAt: nowIso(),
    status: "running",
    events: [],
  };
}

export function getAgentSpec(agentId: AgentId): AgentSpec {
  return AGENT_SPECS[agentId];
}

export function getAllowedToolNames(agentId: AgentId): Set<string> {
  return new Set(AGENT_SPECS[agentId].allowedTools);
}

export class AgentHarnessRuntime {
  private readonly trace: AgentRunTrace;

  constructor(trace: AgentRunTrace) {
    this.trace = trace;
    this.recordEvent({
      kind: "run_started",
      message: "Agent run started",
      metadata: {
        specialistAgents: Object.values(AGENT_SPECS).map((spec) => ({
          id: spec.id,
          role: spec.role,
          outputContract: spec.outputContract,
          toolCount: spec.allowedTools.length,
        })),
      },
    });
  }

  getTrace(): AgentRunTrace {
    return this.trace;
  }

  recordEvent(event: Omit<AgentTraceEvent, "id" | "runId" | "startedAt"> & { startedAt?: string }): AgentTraceEvent {
    const next: AgentTraceEvent = {
      ...event,
      id: nextEventId(this.trace.runId),
      runId: this.trace.runId,
      startedAt: event.startedAt || nowIso(),
    };
    this.trace.events.push(next);
    return next;
  }

  completeEvent(
    event: AgentTraceEvent,
    patch?: Partial<Omit<AgentTraceEvent, "id" | "runId" | "startedAt">>,
  ): void {
    const completedAt = nowIso();
    Object.assign(event, patch, {
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(event.startedAt || completedAt)),
    });
  }

  recordPhase(phase: string, message?: string): void {
    this.recordEvent({
      kind: "phase_started",
      phase,
      message,
    });
  }

  async withAgentStep<T>(
    agentId: AgentId,
    stepName: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const start = this.recordEvent({
      kind: "agent_step_started",
      agentId,
      message: stepName,
      metadata,
    });
    try {
      const result = await operation();
      this.completeEvent(start, { kind: "agent_step_completed" });
      return result;
    } catch (error) {
      this.completeEvent(start, {
        kind: "agent_step_failed",
        metadata: {
          ...(metadata || {}),
          error: toErrorMessage(error),
        },
      });
      throw error;
    }
  }

  async runModelStep<T>(params: {
    agentId: AgentId;
    stepName: string;
    callModel: () => Promise<string>;
    parse: (rawContent: string) => T;
    metadata?: Record<string, unknown>;
  }): Promise<T> {
    const { agentId, stepName, callModel, parse, metadata } = params;
    const callEvent = this.recordEvent({
      kind: "model_call_started",
      agentId,
      message: stepName,
      metadata,
    });

    let rawContent: string;
    try {
      rawContent = await callModel();
      this.completeEvent(callEvent, {
        kind: "model_call_completed",
        metadata: {
          ...(metadata || {}),
          outputChars: rawContent.length,
        },
      });
    } catch (error) {
      this.completeEvent(callEvent, {
        kind: "model_call_failed",
        metadata: {
          ...(metadata || {}),
          error: toErrorMessage(error),
        },
      });
      throw new AgentHarnessError(
        "model_call_failed",
        `${getAgentSpec(agentId).displayName} 模型调用失败：${toErrorMessage(error)}`,
        { agentId, cause: error, details: metadata },
      );
    }

    try {
      return parse(rawContent);
    } catch (error) {
      throw new AgentHarnessError(
        "structured_output_invalid",
        `${getAgentSpec(agentId).displayName} 输出未满足契约 ${getAgentSpec(agentId).outputContract}：${toErrorMessage(error)}`,
        {
          agentId,
          cause: error,
          details: {
            ...(metadata || {}),
            rawPreview: rawContent.slice(0, 500),
          },
        },
      );
    }
  }

  recordToolBatchStart(toolCalls: ToolCallRequest[]): AgentTraceEvent {
    return this.recordEvent({
      kind: "tool_batch_started",
      agentId: "writer",
      toolNames: toolCalls.map((call) => call.name),
      toolCount: toolCalls.length,
      message: `Tool batch: ${toolCalls.map((call) => call.name).join(", ")}`,
    });
  }

  recordToolBatchComplete(
    event: AgentTraceEvent,
    results: ToolCallResult[],
  ): void {
    const failureCount = results.filter((result) => !result.success).length;
    this.completeEvent(event, {
      kind: "tool_batch_completed",
      toolFailureCount: failureCount,
      metadata: {
        resultNames: results.map((result) => result.name),
      },
    });
  }

  recordToolBatchFailed(
    event: AgentTraceEvent,
    results: ToolCallResult[],
    failureCode: AgentHarnessErrorCode,
  ): void {
    const failedResults = results.filter((result) => !result.success);
    this.completeEvent(event, {
      kind: "tool_batch_failed",
      toolFailureCount: failedResults.length,
      metadata: {
        code: failureCode,
        resultNames: results.map((result) => result.name),
        failedTools: failedResults.map((result) => ({
          id: result.id,
          name: result.name,
          error: result.error || "工具执行失败",
        })),
      },
    });
  }

  recordQualityGate(params: {
    passed: boolean;
    needsReplan: boolean;
    reasons: string[];
    finalReviewScore: number | null;
  }): void {
    this.recordEvent({
      kind: "quality_gate_completed",
      phase: "reviewing",
      message: params.passed ? "Quality gate passed" : "Quality gate failed",
      metadata: params,
    });
  }

  completeRun(): void {
    this.trace.status = "completed";
    this.trace.completedAt = nowIso();
    this.recordEvent({
      kind: "run_completed",
      message: "Agent run completed",
    });
  }

  failRun(error: unknown): void {
    this.trace.status = error instanceof AgentHarnessError && error.code === "cancelled" ? "cancelled" : "failed";
    this.trace.failedAt = nowIso();
    this.recordEvent({
      kind: "run_failed",
      message: toErrorMessage(error),
      metadata: {
        code: error instanceof AgentHarnessError ? error.code : undefined,
      },
    });
  }
}

export function buildAgentTraceSummary(trace: AgentRunTrace): string {
  const completedToolBatches = trace.events.filter((event) =>
    event.kind === "tool_batch_completed" || event.kind === "tool_batch_failed"
  );
  const modelCalls = trace.events.filter((event) => event.kind === "model_call_completed");
  const documentIndexBuilds = trace.events.filter((event) => event.kind === "document_index_completed");
  const rangeReads = trace.events.filter((event) => event.kind === "document_range_read_completed");
  const fullDocumentReadEvents = trace.events.filter((event) =>
    event.kind === "document_read_started"
    || event.kind === "document_read_completed"
    || event.kind === "document_read_failed"
  );
  const failedEvents = trace.events.filter((event) =>
    event.kind === "agent_step_failed" || event.kind === "model_call_failed" || event.kind === "run_failed"
  );
  const totalToolCalls = completedToolBatches.reduce((sum, event) => sum + (event.toolCount || 0), 0);
  const totalToolFailures = completedToolBatches.reduce((sum, event) => sum + (event.toolFailureCount || 0), 0);
  const qualityGate = [...trace.events].reverse().find((event) => event.kind === "quality_gate_completed");
  const promptContract = [...trace.events].reverse().find((event) =>
    event.kind === "prompt_contract_created" || event.kind === "prompt_contract_failed"
  );
  const checkpointMismatch = [...trace.events].reverse().find((event) =>
    event.kind === "checkpoint_contract_mismatch"
  );
  const durationMs = trace.completedAt
    ? Math.max(0, Date.parse(trace.completedAt) - Date.parse(trace.startedAt))
    : trace.failedAt
      ? Math.max(0, Date.parse(trace.failedAt) - Date.parse(trace.startedAt))
      : 0;

  const lines = [
    "### Agent Harness Trace",
    `- Run ID: ${trace.runId}`,
    `- 状态: ${trace.status}`,
    `- 模型调用: ${modelCalls.length}`,
    `- 工具调用: ${totalToolCalls}（失败 ${totalToolFailures}）`,
    `- Document Index 构建: ${documentIndexBuilds.length}`,
    `- 局部 range 读取: ${rangeReads.length}`,
    `- 全文读取事件: ${fullDocumentReadEvents.length}`,
    `- Trace 事件: ${trace.events.length}`,
    `- 耗时: ${Math.round(durationMs / 1000)}s`,
  ];

  if (qualityGate) {
    lines.push(`- 质量门控: ${qualityGate.message || "已记录"}`);
  }
  if (promptContract) {
    const taskType = typeof promptContract.metadata?.taskType === "string"
      ? promptContract.metadata.taskType
      : "unknown";
    lines.push(`- Prompt Contract: ${taskType} / ${promptContract.message || "已记录"}`);
  }
  if (checkpointMismatch) {
    lines.push(`- Checkpoint: ${checkpointMismatch.message || "未恢复旧运行"}`);
  }
  if (failedEvents.length > 0) {
    lines.push(`- 失败事件: ${failedEvents.length}`);
  }

  return lines.join("\n");
}
