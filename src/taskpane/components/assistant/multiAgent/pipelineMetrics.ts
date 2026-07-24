const PIPELINE_METRICS_KEY = "writebot_multi_agent_metrics_v1";
const MAX_HISTORY = 60;

export type IntakePathMetric = "rule" | "llm";

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
  duplicateWriteBlockedCount: number;
  writeTransactionCount: number;
  fullDocumentReadCount: number;
  documentIndexBuildCount: number;
  rangeReadCount: number;
  qualityGateTriggered: boolean;
  qualityGatePassed: boolean;
  finalReviewScore: number | null;
  /** Prompt Intake 路径：规则快路径 vs LLM。 */
  intakePath?: IntakePathMetric;
  /** Prompt Intake 耗时（ms）。 */
  intakeMs?: number;
}

export interface PipelineMetricsSummary {
  runCount: number;
  passRate: number;
  avgDurationMs: number;
  avgReviewRounds: number;
  avgReworkRate: number;
  avgDuplicateWriteRate: number;
  avgRangeReadCount: number;
  fullDocumentReadRuns: number;
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
      avgRangeReadCount: 0,
      fullDocumentReadRuns: 0,
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
    return sum + ((item.duplicateWriteSkips ?? 0) + (item.duplicateWriteBlockedCount ?? 0)) / toolBase;
  }, 0);
  const rangeReadTotal = history.reduce((sum, item) => sum + (item.rangeReadCount ?? 0), 0);
  const fullDocumentReadRuns = history.filter((item) => (item.fullDocumentReadCount ?? 0) > 0).length;

  return {
    runCount,
    passRate: passCount / runCount,
    avgDurationMs: durationTotal / runCount,
    avgReviewRounds: reviewRoundsTotal / runCount,
    avgReworkRate: reworkRateTotal / runCount,
    avgDuplicateWriteRate: duplicateRateTotal / runCount,
    avgRangeReadCount: rangeReadTotal / runCount,
    fullDocumentReadRuns,
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

/** 用户可读的剩余时间文案（约 X 分 / 约 X 秒）。 */
export function formatEtaLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "即将完成";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `约 ${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `约 ${minutes} 分 ${seconds} 秒` : `约 ${minutes} 分`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `约 ${hours} 小时 ${remMinutes} 分` : `约 ${hours} 小时`;
}

export type PipelineEtaPhase =
  | "planning"
  | "awaiting_confirmation"
  | "writing"
  | "reviewing"
  | "revising"
  | "completed"
  | "error"
  | "idle"
  | string;

/**
 * 基于历史平均耗时估算剩余时间。
 * 启发式：规划约 8%、撰写按章节比例约 70%、审阅/修订约 22%。
 */
export function estimateRemainingMs(params: {
  history: PipelineRunMetrics[];
  completedSections: number;
  totalSections: number;
  phase: PipelineEtaPhase;
}): number | null {
  const { history, completedSections, totalSections, phase } = params;
  if (phase === "completed" || phase === "idle" || phase === "error") return null;

  const summary = summarizePipelineMetrics(history);
  if (summary.runCount <= 0 || summary.avgDurationMs <= 0) return null;

  const avg = summary.avgDurationMs;
  const planShare = 0.08;
  const writeShare = 0.7;
  const reviewShare = 0.22;
  const total = Math.max(1, totalSections);
  const done = Math.min(Math.max(0, completedSections), total);
  const remainingSections = Math.max(0, total - done);
  const writeProgress = done / total;

  if (phase === "planning" || phase === "awaiting_confirmation") {
    return Math.round(avg * (1 - planShare * 0.5));
  }
  if (phase === "writing") {
    return Math.round(avg * (writeShare * (remainingSections / total) + reviewShare));
  }
  if (phase === "revising") {
    return Math.round(avg * (reviewShare * 0.7 + writeShare * 0.15 * (1 - writeProgress)));
  }
  if (phase === "reviewing") {
    return Math.round(avg * reviewShare * 0.85);
  }
  // 未知阶段：按章节剩余比例
  return Math.round(avg * (remainingSections / total));
}

export function buildEtaProgressLabel(params: {
  history: PipelineRunMetrics[];
  completedSections: number;
  totalSections: number;
  phase: PipelineEtaPhase;
  currentSectionTitle?: string;
}): { etaMs: number | null; etaLabel: string | null; sectionLabel: string | null } {
  const etaMs = estimateRemainingMs(params);
  const etaLabel = etaMs == null ? null : formatEtaLabel(etaMs);
  const title = params.currentSectionTitle?.trim();
  const sectionLabel = title
    ? (params.phase === "revising" ? `正修订：${title}` : `正写：${title}`)
    : null;
  return { etaMs, etaLabel, sectionLabel };
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
  lines.push(`| 重复写入率 | ${toPercent(((latest.duplicateWriteSkips ?? 0) + (latest.duplicateWriteBlockedCount ?? 0)) / Math.max(1, latest.toolCalls))} | ${toPercent(summary.avgDuplicateWriteRate)} |`);
  lines.push(`| 重复写入阻断 | ${latest.duplicateWriteBlockedCount ?? 0} | - |`);
  lines.push(`| 写入 transaction | ${latest.writeTransactionCount ?? 0} | - |`);
  lines.push(`| 全文读取 | ${latest.fullDocumentReadCount} | ${summary.fullDocumentReadRuns} 次运行出现 |`);
  lines.push(`| 局部 range 读取 | ${latest.rangeReadCount} | ${summary.avgRangeReadCount.toFixed(1)} |`);
  lines.push(`| 索引刷新 | ${latest.documentIndexBuildCount} | - |`);
  lines.push(`| 总耗时 | ${formatDuration(latest.durationMs)} | ${formatDuration(summary.avgDurationMs)} |`);
  if (latest.intakePath || latest.intakeMs !== undefined) {
    const pathLabel = latest.intakePath === "rule" ? "规则快路径" : latest.intakePath === "llm" ? "LLM" : "-";
    const intakeLabel = latest.intakeMs !== undefined ? `${latest.intakeMs}ms` : "-";
    lines.push(`| Intake 路径 | ${pathLabel}（${intakeLabel}） | - |`);
  }
  lines.push("");
  if (latest.qualityGateTriggered) {
    lines.push(
      `本次质量门控：${latest.qualityGatePassed ? "通过" : "未通过"}`
      + `${latest.finalReviewScore !== null ? `（最终分 ${latest.finalReviewScore}/10）` : ""}。`,
    );
  } else {
    lines.push("本版本默认仅写作（已跳过自动审校）。");
  }

  return lines.join("\n");
}
