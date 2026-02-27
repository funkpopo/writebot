const PIPELINE_METRICS_KEY = "writebot_multi_agent_metrics_v1";
const MAX_HISTORY = 60;

export interface PipelineRunMetrics {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalSections: number;
  revisedSections: number;
  reviewRounds: number;
  toolCalls: number;
  toolFailures: number;
  duplicateWriteSkips: number;
  qualityGateTriggered: boolean;
  qualityGatePassed: boolean;
  finalReviewScore: number | null;
}

export interface PipelineMetricsSummary {
  runCount: number;
  passRate: number;
  avgDurationMs: number;
  avgReviewRounds: number;
  avgReworkRate: number;
  avgDuplicateWriteRate: number;
}

function getStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function loadPipelineMetricsHistory(): PipelineRunMetrics[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PIPELINE_METRICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => item as PipelineRunMetrics);
  } catch {
    return [];
  }
}

export function savePipelineMetricsHistory(history: PipelineRunMetrics[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(PIPELINE_METRICS_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // ignore
  }
}

export function appendPipelineMetrics(
  metric: PipelineRunMetrics,
): PipelineRunMetrics[] {
  const history = loadPipelineMetricsHistory();
  const nextHistory = [...history, metric].slice(-MAX_HISTORY);
  savePipelineMetricsHistory(nextHistory);
  return nextHistory;
}

export function summarizePipelineMetrics(history: PipelineRunMetrics[]): PipelineMetricsSummary {
  if (history.length === 0) {
    return {
      runCount: 0,
      passRate: 0,
      avgDurationMs: 0,
      avgReviewRounds: 0,
      avgReworkRate: 0,
      avgDuplicateWriteRate: 0,
    };
  }

  const runCount = history.length;
  const passCount = history.filter((item) => item.qualityGatePassed).length;
  const durationTotal = history.reduce((sum, item) => sum + item.durationMs, 0);
  const reviewRoundsTotal = history.reduce((sum, item) => sum + item.reviewRounds, 0);
  const reworkRateTotal = history.reduce((sum, item) => {
    const sectionBase = Math.max(1, item.totalSections);
    return sum + item.revisedSections / sectionBase;
  }, 0);
  const duplicateRateTotal = history.reduce((sum, item) => {
    const toolBase = Math.max(1, item.toolCalls);
    return sum + item.duplicateWriteSkips / toolBase;
  }, 0);

  return {
    runCount,
    passRate: passCount / runCount,
    avgDurationMs: durationTotal / runCount,
    avgReviewRounds: reviewRoundsTotal / runCount,
    avgReworkRate: reworkRateTotal / runCount,
    avgDuplicateWriteRate: duplicateRateTotal / runCount,
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildPipelineMetricsDashboard(
  latest: PipelineRunMetrics,
  history: PipelineRunMetrics[],
): string {
  const summary = summarizePipelineMetrics(history);
  const lines: string[] = [];

  lines.push("### Agent 指标看板");
  lines.push("| 指标 | 本次 | 历史均值 |");
  lines.push("| --- | --- | --- |");
  lines.push(`| 通过率 | ${latest.qualityGatePassed ? "100%" : "0%"} | ${toPercent(summary.passRate)} |`);
  lines.push(`| 返工率 | ${toPercent(latest.revisedSections / Math.max(1, latest.totalSections))} | ${toPercent(summary.avgReworkRate)} |`);
  lines.push(`| 重复写入率 | ${toPercent(latest.duplicateWriteSkips / Math.max(1, latest.toolCalls))} | ${toPercent(summary.avgDuplicateWriteRate)} |`);
  lines.push(`| 平均轮次 | ${latest.reviewRounds.toFixed(1)} | ${summary.avgReviewRounds.toFixed(1)} |`);
  lines.push(`| 总耗时 | ${formatDuration(latest.durationMs)} | ${formatDuration(summary.avgDurationMs)} |`);
  lines.push("");
  lines.push(`本次质量门控：${latest.qualityGatePassed ? "通过" : "未通过"}${latest.finalReviewScore !== null ? `（最终分 ${latest.finalReviewScore}/10）` : ""}。`);

  return lines.join("\n");
}
