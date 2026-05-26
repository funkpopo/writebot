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
  enterEvent?: (nodeId: TNodeId) => AgentRunEvent;
}

export async function runTaskGraph<TState, TNodeId extends string = string>(
  nodes: TaskGraphNode<TState, TNodeId>[],
  startNodeId: TNodeId,
  state: TState,
  isCancelled: () => boolean,
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

    events.push({ type: "enter_node", nodeId: currentNodeId });
    await node.run(state);
    events.push({ type: "exit_node", nodeId: currentNodeId });
    currentNodeId = node.next(state);
  }

  if (!currentNodeId && events.length > 0) {
    events.push({ type: "completed", nodeId: "" });
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
