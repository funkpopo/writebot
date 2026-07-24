import { describe, expect, it } from "bun:test";
import {
  buildEtaProgressLabel,
  buildPipelineMetricsDashboard,
  estimateRemainingMs,
  formatEtaLabel,
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
    duplicateWriteBlockedCount: 1,
    writeTransactionCount: 4,
    fullDocumentReadCount: 0,
    documentIndexBuildCount: 5,
    rangeReadCount: 8,
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
    duplicateWriteBlockedCount: 0,
    writeTransactionCount: 6,
    fullDocumentReadCount: 1,
    documentIndexBuildCount: 4,
    rangeReadCount: 10,
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
    expect(summary.avgRangeReadCount).toBe(9);
    expect(summary.fullDocumentReadRuns).toBe(1);
  });

  it("builds dashboard markdown", () => {
    const dashboard = buildPipelineMetricsDashboard(sampleRuns[0], sampleRuns);
    expect(dashboard).toContain("Agent 指标看板");
    expect(dashboard).toContain("重复写入阻断");
    expect(dashboard).toContain("写入 transaction");
    expect(dashboard).toContain("全文读取");
    expect(dashboard).toContain("局部 range 读取");
    expect(dashboard).toContain("本次质量门控");
  });

  it("notes skipped quality gate when not triggered", () => {
    const skipGateRun: PipelineRunMetrics = {
      ...sampleRuns[0],
      qualityGateTriggered: false,
      qualityGatePassed: true,
      finalReviewScore: null,
    };
    const dashboard = buildPipelineMetricsDashboard(skipGateRun, [skipGateRun]);
    expect(dashboard).toContain("本版本默认仅写作（已跳过自动审校）");
  });

  it("includes intake path and duration when present", () => {
    const withIntake: PipelineRunMetrics = {
      ...sampleRuns[0],
      intakePath: "rule",
      intakeMs: 3,
    };
    const dashboard = buildPipelineMetricsDashboard(withIntake, [withIntake]);
    expect(dashboard).toContain("Intake 路径");
    expect(dashboard).toContain("规则快路径");
    expect(dashboard).toContain("3ms");
  });

  it("formats ETA labels for seconds and minutes", () => {
    expect(formatEtaLabel(12_000)).toBe("约 12 秒");
    expect(formatEtaLabel(90_000)).toBe("约 1 分 30 秒");
    expect(formatEtaLabel(120_000)).toBe("约 2 分");
  });

  it("estimates remaining time from history and section progress", () => {
    const midWrite = estimateRemainingMs({
      history: sampleRuns,
      completedSections: 2,
      totalSections: 4,
      phase: "writing",
    });
    expect(midWrite).not.toBeNull();
    expect(midWrite!).toBeGreaterThan(0);

    const afterDone = estimateRemainingMs({
      history: sampleRuns,
      completedSections: 4,
      totalSections: 4,
      phase: "completed",
    });
    expect(afterDone).toBeNull();

    const noHistory = estimateRemainingMs({
      history: [],
      completedSections: 0,
      totalSections: 4,
      phase: "writing",
    });
    expect(noHistory).toBeNull();
  });

  it("builds progress labels with section title and ETA", () => {
    const label = buildEtaProgressLabel({
      history: sampleRuns,
      completedSections: 1,
      totalSections: 4,
      phase: "writing",
      currentSectionTitle: "引言",
    });
    expect(label.sectionLabel).toBe("正写：引言");
    expect(label.etaLabel).toMatch(/^约 /);
    expect(label.etaMs).toBeGreaterThan(0);

    const revising = buildEtaProgressLabel({
      history: sampleRuns,
      completedSections: 4,
      totalSections: 4,
      phase: "revising",
      currentSectionTitle: "结论",
    });
    expect(revising.sectionLabel).toBe("正修订：结论");
  });
});
