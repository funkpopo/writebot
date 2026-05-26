import { describe, expect, it } from "bun:test";
import {
  AgentHarnessRuntime,
  AgentHarnessError,
  buildAgentTraceSummary,
  createAgentRunTrace,
} from "../agentHarness";

describe("agentHarness", () => {
  it("records specialist specs and model step completion", async () => {
    const trace = createAgentRunTrace("run_test", "写一篇文章");
    const harness = new AgentHarnessRuntime(trace);

    const parsed = await harness.runModelStep({
      agentId: "planner",
      stepName: "planner.generate_outline",
      callModel: async () => "{\"ok\":true}",
      parse: (raw) => JSON.parse(raw) as { ok: boolean },
    });

    harness.completeRun();
    expect(parsed.ok).toBe(true);
    expect(trace.status).toBe("completed");
    expect(trace.events.some((event) => event.kind === "run_started")).toBe(true);
    expect(trace.events.some((event) => event.kind === "model_call_completed")).toBe(true);
  });

  it("throws structured output errors without synthetic recovery", async () => {
    const harness = new AgentHarnessRuntime(createAgentRunTrace("run_bad_json", "写一篇文章"));

    await expect(harness.runModelStep({
      agentId: "reviewer",
      stepName: "reviewer.review_document",
      callModel: async () => "not json",
      parse: (raw) => JSON.parse(raw),
    })).rejects.toThrow(AgentHarnessError);
  });

  it("summarizes failed tool batches", () => {
    const trace = createAgentRunTrace("run_tools", "写一篇文章");
    const harness = new AgentHarnessRuntime(trace);
    const event = harness.recordToolBatchStart([
      { id: "tool_1", name: "append_text", arguments: { text: "正文" } },
    ]);
    harness.completeEvent(event, {
      kind: "tool_batch_failed",
      toolFailureCount: 1,
    });
    harness.failRun(new AgentHarnessError("tool_batch_failed", "工具失败", { agentId: "writer" }));

    const summary = buildAgentTraceSummary(trace);
    expect(summary).toContain("工具调用: 1");
    expect(summary).toContain("失败 1");
    expect(summary).toContain("状态: failed");
  });
});
