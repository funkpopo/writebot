/**
 * Agent 运行控制器 —— 纯逻辑层（与 React / DOM / localStorage 解耦）。
 *
 * 从 useAgentLoop / useAssistantState 中抽取的所有可独立测试的纯函数与
 * 无渲染副作用的状态机集中在这里：
 * - 流式输出批处理（createStreamingBatcher，计时器可注入）
 * - 运行代次控制（createRunController，停止/取消判定）
 * - 阶段进度解析与计划视图元数据（extractSectionProgressFromMessage /
 *   toPlanMarkdownFromOutline / withPlanProgressMeta，metrics 历史可注入）
 * - 待应用事务句柄（appendPendingAgentTransaction）
 * - 会话消息与存储格式互转 / 可见消息裁剪（纯数据变换）
 *
 * 测试见 ./agentRunController.test.ts（不 mock React、不 mock localStorage）。
 */

import type { ArticleOutline, MultiAgentPhase } from "./multiAgent/types";
import { buildEtaProgressLabel, loadPipelineMetricsHistory, type PipelineRunMetrics } from "./multiAgent/pipelineMetrics";
import type { AgentPlanViewState, AppliedUndoHandle } from "./useAssistantState";
import type { ActionType, Message } from "./types";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import type { StoredMessage } from "../../../utils/storageService";

/** 可见消息上限，超过后裁剪最旧消息（配合各 UI 状态集合同步过滤）。 */
export const MAX_VISIBLE_MESSAGES = 80;

// ── 流式输出批处理 ──────────────────────────────────────────

export interface BatcherTimers {
  setTimeout: (handler: () => void, timeoutMs: number) => number;
  clearTimeout: (handle: number) => void;
}

const defaultBatcherTimers: BatcherTimers = {
  setTimeout: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/**
 * 将高频流式 chunk 合并为 ~50ms 一次的批量更新，减少 React 重渲染次数。
 * 纯闭包实现，计时器可注入（测试中手动驱动 flush）。
 */
export function createStreamingBatcher(
  setter: (updater: (prev: string) => string) => void,
  options?: { timers?: BatcherTimers; flushDelayMs?: number }
) {
  const timers = options?.timers ?? defaultBatcherTimers;
  const flushDelayMs = options?.flushDelayMs ?? 50;
  let pending = "";
  let timer: number | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const chunk = pending;
    pending = "";
    setter((prev) => prev + chunk);
  };

  const push = (chunk: string) => {
    if (!chunk) return;
    pending += chunk;
    if (timer !== null) return;
    timer = timers.setTimeout(flush, flushDelayMs);
  };

  const cancel = () => {
    pending = "";
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  return { push, flush, cancel };
}

// ── 运行代次控制 ────────────────────────────────────────────

export interface AgentRunControl {
  /** 开始新运行，返回该次运行的代次 id（并重置停止标记）。 */
  beginRun(): number;
  /** 运行是否已被取消：用户请求停止，或已有更新的运行开始。 */
  isRunCancelled(runId: number): boolean;
  /** 用户请求停止：标记停止并使当前运行代次失效。 */
  requestStop(): void;
}

export function createRunControl(): AgentRunControl {
  let stopRequested = false;
  let activeRunId = 0;

  return {
    beginRun(): number {
      stopRequested = false;
      activeRunId += 1;
      return activeRunId;
    },
    isRunCancelled(runId: number): boolean {
      return stopRequested || activeRunId !== runId;
    },
    requestStop(): void {
      stopRequested = true;
      activeRunId += 1;
    },
  };
}

// ── 阶段进度 / 计划视图 ─────────────────────────────────────

/** 从状态消息中解析 "current / total" 形式的章节进度。 */
export function extractSectionProgressFromMessage(
  message?: string
): { current: number; total: number } | null {
  if (!message) return null;
  const match = message.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const current = Number.parseInt(match[1]!, 10);
  const total = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return {
    current: Math.min(Math.max(0, current), total),
    total: Math.max(1, total),
  };
}

/** 将大纲渲染为计划视图 Markdown（章节列表）。 */
export function toPlanMarkdownFromOutline(outline: ArticleOutline): string {
  const lines = ["## 阶段计划"];
  for (let index = 0; index < outline.sections.length; index += 1) {
    lines.push(`${index + 1}. ${outline.sections[index]!.title}`);
  }
  return lines.join("\n");
}

export interface PlanProgressMetaDeps {
  /** 注入 metrics 历史（测试注入固定值；默认读真实 pipeline metrics 存储）。 */
  loadHistory?: () => PipelineRunMetrics[];
}

/**
 * 为计划视图附加 ETA/当前章节元数据。
 * 纯计算（输入 base + phase，输出新视图对象）；仅 metrics 历史通过依赖注入获取。
 */
export function withPlanProgressMeta(
  base: Pick<AgentPlanViewState, "content" | "currentStage" | "totalStages" | "completedStages"> & {
    currentSectionTitle?: string;
  },
  phase: MultiAgentPhase,
  deps?: PlanProgressMetaDeps
): AgentPlanViewState {
  const completedCount = Math.max(
    base.completedStages.length,
    Math.max(0, base.currentStage - (phase === "writing" ? 1 : 0)),
  );
  const eta = buildEtaProgressLabel({
    history: deps?.loadHistory ? deps.loadHistory() : loadPipelineMetricsHistory(),
    completedSections: completedCount,
    totalSections: Math.max(1, base.totalStages),
    phase,
    currentSectionTitle: base.currentSectionTitle,
  });
  return {
    content: base.content,
    currentStage: base.currentStage,
    totalStages: base.totalStages,
    completedStages: base.completedStages,
    currentSectionTitle: base.currentSectionTitle || eta.sectionLabel?.replace(/^正写：/, "") || undefined,
    etaLabel: eta.etaLabel || undefined,
    updatedAt: new Date().toISOString(),
  };
}

// ── 待应用事务句柄 ──────────────────────────────────────────

/**
 * 向待应用事务句柄追加事务 id（原语义：复用已有句柄对象就地更新）。
 */
export function appendPendingAgentTransaction(
  current: AppliedUndoHandle | null,
  transactionId: string,
  operationGroupId?: string
): AppliedUndoHandle {
  if (!current) {
    return {
      transactionIds: [transactionId],
      operationGroupId,
    };
  }
  if (!current.transactionIds.includes(transactionId)) {
    current.transactionIds.push(transactionId);
  }
  if (operationGroupId) {
    current.operationGroupId = operationGroupId;
  }
  return current;
}

// ── 会话消息：存储格式互转 / 裁剪 ────────────

/** 存储的会话消息 → React Message（补齐 plainText / timestamp）。 */
export function normalizeStoredConversationMessages(stored: StoredMessage[]): Message[] {
  return stored.map((msg) => ({
    ...msg,
    plainText: msg.plainText || (msg.type === "assistant" ? sanitizeMarkdownToPlainText(msg.content) : undefined),
    applyContent: msg.applyContent,
    action: msg.action as ActionType,
    actionLabel: msg.actionLabel,
    timestamp: new Date(msg.timestamp),
  }));
}

/** React Message → 存储格式（timestamp 转 ISO 字符串）。 */
export function toStoredConversationMessages(messages: Message[]): StoredMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    type: msg.type,
    content: msg.content,
    plainText: msg.plainText,
    applyContent: msg.applyContent,
    thinking: msg.thinking,
    action: msg.action || undefined,
    actionLabel: msg.actionLabel,
    uiOnly: msg.uiOnly,
    timestamp: msg.timestamp.toISOString(),
  }));
}

/**
 * 计算可见消息裁剪结果。超出上限时返回保留的最新消息与保留 id 集合；
 * 未超出时返回 null（无需裁剪）。
 */
export function pruneVisibleMessages(
  messages: Message[],
  maxVisible: number = MAX_VISIBLE_MESSAGES
): { nextMessages: Message[]; retainedIds: Set<string> } | null {
  if (messages.length <= maxVisible) return null;

  const nextMessages = messages.slice(-maxVisible);
  const retainedIds = new Set(nextMessages.map((message) => message.id));
  return { nextMessages, retainedIds };
}
