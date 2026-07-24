const PIPELINE_METRICS_KEY = "writebot_multi_agent_metrics_v1";
const MAX_HISTORY = 60;

export type IntakePathMetric = "rule" | "llm";

export interface PipelineRunMetrics {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalSections: number;
  toolCalls: number;
  toolFailures: number;
  duplicateWriteSkips: number;
  duplicateWriteBlockedCount: number;
  writeTransactionCount: number;
  fullDocumentReadCount: number;
  documentIndexBuildCount: number;
  rangeReadCount: number;
  /** Prompt Intake 路径：规则快路径 vs LLM。 */
  intakePath?: IntakePathMetric;
  /** Prompt Intake 耗时（ms）。 */
  intakeMs?: number;
}

export interface PipelineMetricsSummary {
  runCount: number;
  avgDurationMs: number;
  avgDuplicateWriteRate: number;
  avgRangeReadCount: number;
  fullDocumentReadRuns: number;
}

function getStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function normalizeMetric(item: Record<string, unknown>): PipelineRunMetrics | null {
  if (typeof item.runId !== "string" || typeof item.durationMs !== "number") return null;
  return {
    runId: item.runId,
    startedAt: typeof item.startedAt === "string" ? item.startedAt : "",
    finishedAt: typeof item.finishedAt === "string" ? item.finishedAt : "",
    durationMs: item.durationMs,
    totalSections: typeof item.totalSections === "number" ? item.totalSections : 0,
    toolCalls: typeof item.toolCalls === "number" ? item.toolCalls : 0,
    toolFailures: typeof item.toolFailures === "number" ? item.toolFailures : 0,
    duplicateWriteSkips: typeof item.duplicateWriteSkips === "number" ? item.duplicateWriteSkips : 0,
    duplicateWriteBlockedCount: typeof item.duplicateWriteBlockedCount === "number" ? item.duplicateWriteBlockedCount : 0,
    writeTransactionCount: typeof item.writeTransactionCount === "number" ? item.writeTransactionCount : 0,
    fullDocumentReadCount: typeof item.fullDocumentReadCount === "number" ? item.fullDocumentReadCount : 0,
    documentIndexBuildCount: typeof item.documentIndexBuildCount === "number" ? item.documentIndexBuildCount : 0,
    rangeReadCount: typeof item.rangeReadCount === "number" ? item.rangeReadCount : 0,
    intakePath: item.intakePath === "rule" || item.intakePath === "llm" ? item.intakePath : undefined,
    intakeMs: typeof item.intakeMs === "number" ? item.intakeMs : undefined,
  };
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
      .map((item) => normalizeMetric(item as Record<string, unknown>))
      .filter((item): item is PipelineRunMetrics => item !== null);
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
      avgDurationMs: 0,
      avgDuplicateWriteRate: 0,
      avgRangeReadCount: 0,
      fullDocumentReadRuns: 0,
    };
  }

  const runCount = history.length;
  const durationTotal = history.reduce((sum, item) => sum + item.durationMs, 0);
  const duplicateRateTotal = history.reduce((sum, item) => {
    const toolBase = Math.max(1, item.toolCalls);
    return sum + ((item.duplicateWriteSkips ?? 0) + (item.duplicateWriteBlockedCount ?? 0)) / toolBase;
  }, 0);
  const rangeReadTotal = history.reduce((sum, item) => sum + (item.rangeReadCount ?? 0), 0);
  const fullDocumentReadRuns = history.filter((item) => (item.fullDocumentReadCount ?? 0) > 0).length;

  return {
    runCount,
    avgDurationMs: durationTotal / runCount,
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
  | "completed"
  | "error"
  | "idle"
  | string;

/**
 * 基于历史平均耗时估算剩余时间。
 * 启发式：规划约 10%、撰写按章节比例约 90%。
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
  const planShare = 0.1;
  const writeShare = 0.9;
  const total = Math.max(1, totalSections);
  const done = Math.min(Math.max(0, completedSections), total);
  const remainingSections = Math.max(0, total - done);

  if (phase === "planning" || phase === "awaiting_confirmation") {
    return Math.round(avg * (1 - planShare * 0.5));
  }
  if (phase === "writing") {
    return Math.round(avg * writeShare * (remainingSections / total));
  }
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
  const sectionLabel = title ? `正写：${title}` : null;
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

  return lines.join("\n");
}
