import { describe, expect, it } from "bun:test";
import {
  buildPipelineMetricsDashboard,
  summarizePipelineMetrics,
  type PipelineRunMetrics,
} from "../pipelineMetrics";

const sampleRuns: PipelineRunMetrics[] = [
  {
    runId: "r1",
    startedAt: "2026-02-27T10:00:00.000Z",
    finishedAt: "2026-02-27T10:01:00.000Z",
    durationMs: 60000,
    totalSections: 4,
    revisedSections: 1,
    reviewRounds: 2,
    toolCalls: 20,
    toolFailures: 0,
    duplicateWriteSkips: 2,
    qualityGateTriggered: true,
    qualityGatePassed: true,
    finalReviewScore: 8,
  },
  {
    runId: "r2",
    startedAt: "2026-02-27T11:00:00.000Z",
    finishedAt: "2026-02-27T11:02:00.000Z",
    durationMs: 120000,
    totalSections: 5,
    revisedSections: 2,
    reviewRounds: 3,
    toolCalls: 25,
    toolFailures: 1,
    duplicateWriteSkips: 1,
    qualityGateTriggered: true,
    qualityGatePassed: false,
    finalReviewScore: 7,
  },
];

describe("pipelineMetrics", () => {
  it("summarizes history averages", () => {
    const summary = summarizePipelineMetrics(sampleRuns);
    expect(summary.runCount).toBe(2);
    expect(summary.passRate).toBe(0.5);
    expect(summary.avgReviewRounds).toBe(2.5);
    expect(summary.avgDurationMs).toBe(90000);
  });

  it("builds dashboard markdown", () => {
    const dashboard = buildPipelineMetricsDashboard(sampleRuns[0], sampleRuns);
    expect(dashboard).toContain("Agent 指标看板");
    expect(dashboard).toContain("返工率");
    expect(dashboard).toContain("本次质量门控");
  });
});
