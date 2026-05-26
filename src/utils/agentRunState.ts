// ── Agent Node IDs ──

export const AGENT_NODE_IDS = [
  "planning",
  "awaiting_confirmation",
  "init_memory",
  "writing_sections",
  "review_cycle",
  "finalize",
  "error",
] as const;

export type AgentNodeId = typeof AGENT_NODE_IDS[number];

// ── Agent Run States ──

export const AGENT_RUN_STATES = [
  "idle",
  "running",
  "awaiting_confirmation",
  "completed",
  "error",
  "cancelled",
] as const;

export type AgentRunState = typeof AGENT_RUN_STATES[number];

// ── Checkpoint Status (persisted) ──

export const AGENT_CHECKPOINT_STATUSES = [
  "running",
  "completed",
  "error",
  "cancelled",
] as const;

export type AgentCheckpointStatus = typeof AGENT_CHECKPOINT_STATUSES[number];

// ── Run Events ──

export type AgentRunEvent =
  | { type: "start"; nodeId?: AgentNodeId }
  | { type: "enter_node"; nodeId: AgentNodeId }
  | { type: "await_confirmation" }
  | { type: "confirm" }
  | { type: "complete" }
  | { type: "fail"; nodeId?: AgentNodeId }
  | { type: "cancel"; nodeId?: AgentNodeId }
  | { type: "reset" };

// ── Transition Validation ──

/**
 * Allowed transitions: from → to.
 * Missing event types are disallowed.
 */
const ALLOWED_TRANSITIONS: Record<AgentRunState, Partial<Record<AgentRunEvent["type"], AgentRunState>>> = {
  idle: {
    start: "running",
    reset: "idle",
  },
  running: {
    enter_node: "running",
    await_confirmation: "awaiting_confirmation",
    fail: "error",
    cancel: "cancelled",
    complete: "completed",
  },
  awaiting_confirmation: {
    confirm: "running",
    cancel: "cancelled",
    fail: "error",
  },
  completed: {
    reset: "idle",
  },
  error: {
    reset: "idle",
    start: "running",
  },
  cancelled: {
    reset: "idle",
    start: "running",
  },
};

export class InvalidAgentRunTransitionError extends Error {
  constructor(
    public readonly from: AgentRunState,
    public readonly event: AgentRunEvent,
  ) {
    super(`Agent run state transition 非法: ${from} -> ${event.type}`);
    this.name = "InvalidAgentRunTransitionError";
  }
}

// ── Guards / Helpers ──

export function isAgentNodeId(value: unknown): value is AgentNodeId {
  return typeof value === "string" && AGENT_NODE_IDS.includes(value as AgentNodeId);
}

export function normalizeAgentNodeId(value: unknown, fallback: AgentNodeId): AgentNodeId {
  return isAgentNodeId(value) ? value : fallback;
}

export function isAgentRunState(value: unknown): value is AgentRunState {
  return typeof value === "string" && AGENT_RUN_STATES.includes(value as AgentRunState);
}

export function isAgentCheckpointStatus(value: unknown): value is AgentCheckpointStatus {
  return typeof value === "string" && AGENT_CHECKPOINT_STATUSES.includes(value as AgentCheckpointStatus);
}

export function checkpointStatusToRunState(
  status: AgentCheckpointStatus,
  nodeId: AgentNodeId,
): AgentRunState {
  if (status !== "running") return status;
  return nodeId === "awaiting_confirmation" ? "awaiting_confirmation" : "running";
}

export function runStateToCheckpointStatus(
  state: AgentRunState,
): AgentCheckpointStatus {
  if (state === "completed" || state === "error" || state === "cancelled") return state;
  return "running";
}

// ── State Machine Reducer ──

export function reduceAgentRunState(current: AgentRunState, event: AgentRunEvent): AgentRunState {
  const allowed = ALLOWED_TRANSITIONS[current]?.[event.type];
  if (allowed === undefined) {
    throw new InvalidAgentRunTransitionError(current, event);
  }
  return allowed;
}

// ── TrackedAgentRunState (production wrapper) ──

export interface RunStateEntry {
  state: AgentRunState;
  event: AgentRunEvent;
  at: number;
}

export interface TrackedAgentRunState {
  readonly current: AgentRunState;
  readonly history: readonly RunStateEntry[];
  transition(event: AgentRunEvent): AgentRunState;
  reset(): void;
}

export function createTrackedAgentRunState(initial: AgentRunState = "idle"): TrackedAgentRunState {
  const history: RunStateEntry[] = [];
  let current = initial;

  const record = (event: AgentRunEvent, next: AgentRunState): void => {
    history.push({ state: next, event, at: Date.now() });
    current = next;
  };

  return {
    get current(): AgentRunState {
      return current;
    },
    get history(): readonly RunStateEntry[] {
      return history;
    },
    transition(event: AgentRunEvent): AgentRunState {
      const next = reduceAgentRunState(current, event);
      record(event, next);
      return next;
    },
    reset(): void {
      current = "idle";
      history.length = 0;
    },
  };
}
