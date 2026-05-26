import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import { runTaskGraph, type TaskGraphNode } from "../taskGraph";

describe("taskGraph", () => {
  it("throws structured cancellation errors instead of stopping silently", async () => {
    const nodes: TaskGraphNode<{ visited: string[] }>[] = [
      {
        id: "planning",
        run: async (state) => {
          state.visited.push("planning");
        },
        next: () => null,
      },
    ];

    let caught: unknown;
    try {
      await runTaskGraph(nodes, "planning", { visited: [] }, () => true);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentHarnessError);
    expect((caught as AgentHarnessError).code).toBe("cancelled");
  });
});
