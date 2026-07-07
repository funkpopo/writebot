import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import { runTaskGraph, type TaskGraphNode } from "../taskGraph";

describe("taskGraph", () => {
  it("emits node enter run events before executing the node", async () => {
    const observed: string[] = [];
    const nodes: TaskGraphNode<{ visited: string[] }>[] = [
      {
        id: "planning",
        enterEvent: () => ({ type: "start", nodeId: "planning" }),
        run: async (state) => {
          state.visited.push("planning");
          observed.push("run");
        },
        next: () => null,
      },
    ];

    const context = await runTaskGraph(
      nodes,
      "planning",
      { visited: [] },
      () => false,
      {
        onRunEvent: (event) => {
          observed.push(`event:${event.type}`);
        },
      },
    );

    expect(observed).toEqual(["event:start", "run"]);
    expect(context.events.map((event) => event.type)).toEqual(["enter_node", "exit_node", "completed"]);
  });

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
