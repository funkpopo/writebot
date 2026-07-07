import type {
  AgentNodeId,
  AgentRunEvent,
} from "../../../../utils/agentRunState";
import { AgentHarnessError } from "./agentHarness";

export class TaskGraphNodeNotFoundError extends Error {
  constructor(nodeId: string) {
    super(`TaskGraph 节点不存在: ${nodeId}`);
    this.name = "TaskGraphNodeNotFoundError";
  }
}

export class TaskGraphMaxVisitsExceededError extends Error {
  constructor(nodeId: string, maxVisits: number) {
    super(`TaskGraph 节点循环超过上限: ${nodeId} (上限 ${maxVisits})`);
    this.name = "TaskGraphMaxVisitsExceededError";
  }
}

export interface TaskGraphEvent<TNodeId extends string = string> {
  type: "enter_node" | "exit_node" | "completed";
  nodeId: TNodeId | "";
}

export interface TaskGraphContext<TNodeId extends string = string> {
  currentNodeId: TNodeId | "";
  visitCount: Partial<Record<TNodeId, number>>;
  events: TaskGraphEvent<TNodeId>[];
}

export interface TaskGraphNode<TState, TNodeId extends string = string> {
  id: TNodeId;
  run: (state: TState) => Promise<void>;
  next: (state: TState) => TNodeId | null;
  maxVisits?: number;
  /** Optional: derive a run event to emit when this node is entered (used for state machine integration). */
  enterEvent?: (nodeId: TNodeId, state: TState) => AgentRunEvent | null | undefined;
}

export interface TaskGraphRunOptions<TState, TNodeId extends string = string> {
  onRunEvent?: (event: AgentRunEvent, nodeId: TNodeId, state: TState) => void | Promise<void>;
  onGraphEvent?: (event: TaskGraphEvent<TNodeId>, state: TState) => void | Promise<void>;
}

export async function runTaskGraph<TState, TNodeId extends string = string>(
  nodes: TaskGraphNode<TState, TNodeId>[],
  startNodeId: TNodeId,
  state: TState,
  isCancelled: () => boolean,
  options: TaskGraphRunOptions<TState, TNodeId> = {},
): Promise<TaskGraphContext<TNodeId>> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visitCount: Partial<Record<TNodeId, number>> = {};
  const events: TaskGraphEvent<TNodeId>[] = [];
  let currentNodeId: TNodeId | null = startNodeId;

  while (currentNodeId) {
    if (isCancelled()) {
      throw new AgentHarnessError(
        "cancelled",
        `TaskGraph 已取消，当前节点: ${currentNodeId}`,
      );
    }
    const node = nodeMap.get(currentNodeId);
    if (!node) {
      throw new TaskGraphNodeNotFoundError(String(currentNodeId));
    }

    visitCount[currentNodeId] = (visitCount[currentNodeId] || 0) + 1;
    const maxVisits = Math.max(1, node.maxVisits ?? 1);
    if ((visitCount[currentNodeId] ?? 0) > maxVisits) {
      throw new TaskGraphMaxVisitsExceededError(String(currentNodeId), maxVisits);
    }

    const enterGraphEvent: TaskGraphEvent<TNodeId> = { type: "enter_node", nodeId: currentNodeId };
    events.push(enterGraphEvent);
    await options.onGraphEvent?.(enterGraphEvent, state);

    const enterRunEvent = node.enterEvent?.(currentNodeId, state);
    if (enterRunEvent) {
      await options.onRunEvent?.(enterRunEvent, currentNodeId, state);
    }

    await node.run(state);
    const exitGraphEvent: TaskGraphEvent<TNodeId> = { type: "exit_node", nodeId: currentNodeId };
    events.push(exitGraphEvent);
    await options.onGraphEvent?.(exitGraphEvent, state);
    currentNodeId = node.next(state);
  }

  if (!currentNodeId && events.length > 0) {
    const completedEvent: TaskGraphEvent<TNodeId> = { type: "completed", nodeId: "" };
    events.push(completedEvent);
    await options.onGraphEvent?.(completedEvent, state);
  }

  return {
    currentNodeId: currentNodeId || "",
    visitCount,
    events,
  };
}

/** Helper: create a typed AgentNodeId enter event for task graph nodes that are tied to the agent state machine. */
export function agentNodeEnterEvent(nodeId: AgentNodeId): AgentRunEvent {
  return { type: "enter_node", nodeId };
}
