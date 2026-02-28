export interface TaskGraphContext {
  currentNodeId: string;
  visitCount: Record<string, number>;
}

export interface TaskGraphNode<TState> {
  id: string;
  run: (state: TState) => Promise<void>;
  next: (state: TState) => string | null;
  maxVisits?: number;
}

export async function runTaskGraph<TState>(
  nodes: TaskGraphNode<TState>[],
  startNodeId: string,
  state: TState,
  isCancelled: () => boolean,
): Promise<TaskGraphContext> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visitCount: Record<string, number> = {};
  let currentNodeId: string | null = startNodeId;

  while (currentNodeId) {
    if (isCancelled()) break;
    const node = nodeMap.get(currentNodeId);
    if (!node) {
      throw new Error(`TaskGraph 节点不存在: ${currentNodeId}`);
    }

    visitCount[currentNodeId] = (visitCount[currentNodeId] || 0) + 1;
    const maxVisits = Math.max(1, node.maxVisits ?? 1);
    if (visitCount[currentNodeId] > maxVisits) {
      throw new Error(`TaskGraph 节点循环超过上限: ${currentNodeId}`);
    }

    await node.run(state);
    currentNodeId = node.next(state);
  }

  return {
    currentNodeId: currentNodeId || "",
    visitCount,
  };
}
