import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import { editTransactionService } from "../../../../utils/editTransactionService";
import {
  createSectionFlushState,
  flushAfterSectionIfDue,
  flushSectionPersistenceIfPending,
} from "./checkpointRuntime";
import { resolveWrittenSectionFromTransaction } from "./documentRuntime";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";
import type { DocumentSession } from "./documentSession";
import { buildMemoryContextForSection, updateLongTermMemoryWithSection, type LongTermMemoryState } from "./longTermMemory";
import { runParallelProduceOrderedCommit } from "./orderedCommitQueue";
import type { RuntimeAgentOptions } from "./runtimeOptions";
import type { RunMetricsDraft, TrackedToolExecutor } from "./runtimeTypes";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  OutlineSection,
  SectionWriteResult,
  SectionWriteRange,
} from "./types";
import { draftSection } from "./writerAgent";
import {
  buildInsertAtAnchorToolCall,
  buildReplaceRangeToolCall,
  buildSkippedDuplicateWriteResult,
  checkDuplicateWriteGuard,
  throwIfDuplicateWriteBlocked,
} from "./writerWriteGuards";

export function updateWrittenSectionCache(
  writtenSections: SectionWriteResult[],
  sectionId: string,
  sectionTitle: string,
  content: string,
  range?: SectionWriteRange,
): void {
  const index = writtenSections.findIndex((item) => item.sectionId === sectionId);
  const previousRange = index >= 0 ? writtenSections[index].range : undefined;
  const next: SectionWriteResult = {
    sectionId,
    sectionTitle,
    content,
    range: range || previousRange,
  };
  if (index >= 0) {
    writtenSections[index] = next;
    return;
  }
  writtenSections.push(next);
}

export function toSectionWriteRange(
  range: { rangeId: string; startParagraphIndex: number; endParagraphIndex: number; paragraphCount: number },
  transactionIds: string[],
): SectionWriteRange {
  return {
    rangeId: range.rangeId,
    startParagraphIndex: range.startParagraphIndex,
    endParagraphIndex: range.endParagraphIndex,
    paragraphCount: range.paragraphCount,
    transactionIds,
  };
}

export function shiftWrittenSectionRangesAfter(
  writtenSections: SectionWriteResult[],
  boundaryEndParagraphIndex: number,
  deltaParagraphs: number,
  excludeSectionId?: string,
): void {
  if (deltaParagraphs === 0) return;
  for (const written of writtenSections) {
    if (!written.range || written.sectionId === excludeSectionId) continue;
    if (written.range.startParagraphIndex <= boundaryEndParagraphIndex) continue;
    written.range = {
      ...written.range,
      startParagraphIndex: Math.max(0, written.range.startParagraphIndex + deltaParagraphs),
      endParagraphIndex: Math.max(0, written.range.endParagraphIndex + deltaParagraphs),
      rangeId: undefined,
    };
  }
}

function stripFenceMarkers(lines: string[]): string[] {
  return lines.filter((line) => !/^\s*```/.test(line.trim()));
}

function isLikelyDraftLeadIn(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^(好的|当然|以下|这里|这是|下面).{0,40}(第\s*\d+\s*\/\s*\d+\s*章|章节|草稿|内容)/u.test(trimmed)
    || /^为您生成/u.test(trimmed)
    || /^章节.?[“"']?.+[”"']?(撰写|修改)?完成/u.test(trimmed)
    || /^\[\[(STATUS|CONTENT|PLAN_STATE)\]\]$/i.test(trimmed);
}

export function sanitizeSectionDraftContent(rawContent: string): string {
  const normalized = rawContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\f+/g, "\n")
    .trim();
  if (!normalized) return "";

  const lines = stripFenceMarkers(normalized.split("\n"));
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }
  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      cursor += 1;
      continue;
    }
    if (isLikelyDraftLeadIn(line) || /^#{1,6}\s+\S+/.test(line)) {
      cursor += 1;
      continue;
    }
    break;
  }

  const demotedLines = lines.slice(cursor).map((line) => {
    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (!match) return line;

    const headingText = match[2];
    const compactLength = headingText.replace(/\s+/g, "").length;
    const looksLikeSentence = /[。！？；.!?;:：]/.test(headingText);
    const hasClauseMarkers = /[,，]/.test(headingText);

    // Long sentence-like "heading" is usually a model formatting mistake.
    // Keep short real headings, demote suspicious long ones to plain paragraph.
    if (compactLength >= 36 || (compactLength >= 24 && (looksLikeSentence || hasClauseMarkers))) {
      return headingText;
    }
    return line;
  });

  return demotedLines.join("\n").trim();
}

export function ensureSectionWriteText(
  outline: ArticleOutline,
  sectionIndex: number,
  rawContent: string,
): string {
  const section = outline.sections[sectionIndex];
  const trimmed = sanitizeSectionDraftContent(rawContent);
  const hasDocTitle = new RegExp(`^\\s*#\\s+${escapeRegExp(outline.title)}\\s*$`, "m").test(trimmed);
  const hasSectionHeading = new RegExp(`^\\s*##\\s+${escapeRegExp(section.title)}\\s*$`, "m").test(trimmed);

  let normalized = trimmed;
  if (sectionIndex === 0) {
    if (!hasDocTitle) {
      normalized = `# ${outline.title}\n\n${normalized}`;
    }
    if (!hasSectionHeading) {
      const withoutLeadingTitle = normalized
        .replace(new RegExp(`^\\s*#\\s+${escapeRegExp(outline.title)}\\s*`, "m"), "")
        .trim();
      normalized = `# ${outline.title}\n\n## ${section.title}\n\n${withoutLeadingTitle}`;
    }
  } else if (!hasSectionHeading) {
    normalized = `## ${section.title}\n\n${normalized}`;
  }

  return `${normalized.trimEnd()}\n\n`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function throwIfCancelled(callbacks: OrchestratorCallbacks): void {
  if (!callbacks.isRunCancelled()) return;
  throw new AgentHarnessError("cancelled", "章节写入流程已取消", { agentId: "writer" });
}

function extractTransactionIdsFromResults(toolResults: ToolCallResult[]): string[] {
  const ids: string[] = [];
  for (const result of toolResults) {
    if (!result.success || !result.result || typeof result.result !== "object") continue;
    const transactionId = (result.result as { transactionId?: unknown }).transactionId;
    if (typeof transactionId === "string" && transactionId.trim()) {
      ids.push(transactionId.trim());
    }
  }
  return ids;
}

/**
 * Chapter-level rollback for streaming flushes: reverse-order rollback of all
 * committed insert transactions for this section write.
 */
export async function rollbackChapterFlushTransactions(
  toolResults: ToolCallResult[],
): Promise<void> {
  const transactionIds = extractTransactionIdsFromResults(toolResults);
  for (let i = transactionIds.length - 1; i >= 0; i -= 1) {
    try {
      await editTransactionService.rollbackEdit(transactionIds[i]);
    } catch {
      // Best-effort: continue rolling back earlier inserts.
    }
  }
}

async function insertSectionChunkAtAnchor(params: {
  chunk: string;
  section: OutlineSection;
  callbacks: OrchestratorCallbacks;
  executeToolCalls: TrackedToolExecutor;
  writtenContentSegments: string[];
  documentSession: DocumentSession;
  writtenSections: SectionWriteResult[];
  harness: AgentHarnessRuntime;
  runMetrics: RunMetricsDraft;
  operationGroupId: string;
  runDuplicateGuard: boolean;
}): Promise<ToolCallResult[]> {
  const {
    chunk,
    section,
    callbacks,
    executeToolCalls,
    writtenContentSegments,
    documentSession,
    writtenSections,
    harness,
    runMetrics,
    operationGroupId,
    runDuplicateGuard,
  } = params;

  if (!chunk.trim()) {
    return [];
  }

  const lastParagraph = documentSession.getLastParagraph();
  if (!lastParagraph) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      "无法定位文档末尾锚点，已阻断章节写入",
      { agentId: "writer", details: { sectionId: section.id } },
    );
  }

  let resolvedGroupId = operationGroupId;
  if (runDuplicateGuard) {
    // 落盘裁决：sectionId/cache 优先 → 相同 skip / 不同 replace；标题仅辅助定位。
    const duplicateGuard = await checkDuplicateWriteGuard({
      mode: "new_section",
      section,
      text: chunk,
      contentFormat: "markdown",
      documentSession,
      writtenSections,
      writtenSegments: writtenContentSegments,
      anchorParagraph: lastParagraph,
    });
    // Prefer stream-specific group id when provided; fingerprint id is used for
    // single-shot writes that pass the fingerprint group id as operationGroupId.
    resolvedGroupId = operationGroupId || duplicateGuard.fingerprint.operationGroupId;

    if (duplicateGuard.status === "duplicate") {
      // 写过且相同：幂等 skip
      runMetrics.duplicateWriteSkips += 1;
      return [
        buildSkippedDuplicateWriteResult({
          operationGroupId: resolvedGroupId,
          message: duplicateGuard.message || `章节 ${section.title} 内容已存在`,
        }),
      ];
    }

    if (duplicateGuard.status === "reuse_range" && duplicateGuard.existingRange) {
      // 写过且不同：replace 已有 range，禁止 append
      runMetrics.duplicateWriteBlockedCount += 1;
      const [existingRange] = await documentSession.readRanges(
        harness,
        {
          ranges: [{
            start: duplicateGuard.existingRange.startParagraphIndex,
            end: duplicateGuard.existingRange.endParagraphIndex,
          }],
          maxParagraphs: Math.max(
            1,
            duplicateGuard.existingRange.endParagraphIndex
              - duplicateGuard.existingRange.startParagraphIndex
              + 1,
          ),
        },
        {
          phase: "writing",
          sectionId: section.id,
          moment: "reuse_range_before_replace",
        },
      );
      if (!existingRange) {
        throw new AgentHarnessError(
          "document_range_unresolved",
          `无法读取待替换的同名章节 range：${section.title}`,
          {
            agentId: "writer",
            details: {
              sectionId: section.id,
              existingRange: duplicateGuard.existingRange,
            },
          },
        );
      }
      runMetrics.rangeReadCount += 1;
      const replaceCall = buildReplaceRangeToolCall({
        section,
        text: chunk,
        targetRange: existingRange,
        operationGroupId: resolvedGroupId,
      });
      callbacks.onToolCalls([replaceCall]);
      const replaceResults = await executeToolCalls([replaceCall], writtenContentSegments);
      const replaceFailed = replaceResults.find((item) => !item.success);
      if (replaceFailed) {
        throw new AgentHarnessError(
          "tool_batch_failed",
          replaceFailed.error || `章节 ${section.id} 替换写入失败`,
          {
            agentId: "writer",
            details: {
              sectionId: section.id,
              failedTool: replaceFailed.name,
              failedToolId: replaceFailed.id,
              operationGroupId: resolvedGroupId,
              guardStatus: "reuse_range",
            },
          },
        );
      }
      return replaceResults;
    }

    if (duplicateGuard.status !== "clear") {
      runMetrics.duplicateWriteBlockedCount += 1;
    }
    throwIfDuplicateWriteBlocked({
      result: duplicateGuard,
      section,
      harness,
      mode: "new_section",
    });
  }

  const toolCall: ToolCallRequest = buildInsertAtAnchorToolCall({
    section,
    text: chunk,
    anchorParagraph: lastParagraph,
    operationGroupId: resolvedGroupId,
  });

  callbacks.onToolCalls([toolCall]);
  const results = await executeToolCalls([toolCall], writtenContentSegments);
  const failed = results.find((item) => !item.success);
  if (failed) {
    throw new AgentHarnessError(
      "tool_batch_failed",
      failed.error || `章节 ${section.id} 写入失败`,
      {
        agentId: "writer",
        details: {
          sectionId: section.id,
          failedTool: failed.name,
          failedToolId: failed.id,
          operationGroupId: resolvedGroupId,
        },
      },
    );
  }
  return results;
}

/**
 * 整章一次落盘：先完整草稿，再单次 insert/replace/skip。
 * 比流式分段 flush 更稳，失败面更小。
 */
async function commitSectionText(
  sectionContent: string,
  section: OutlineSection,
  callbacks: OrchestratorCallbacks,
  executeToolCalls: TrackedToolExecutor,
  writtenContentSegments: string[],
  documentSession: DocumentSession,
  writtenSections: SectionWriteResult[],
  harness: AgentHarnessRuntime,
  runMetrics: RunMetricsDraft,
): Promise<ToolCallResult[]> {
  const operationGroupId = `writer_section_${section.id}_${Date.now().toString(36)}`;
  const results = await insertSectionChunkAtAnchor({
    chunk: sectionContent,
    section,
    callbacks,
    executeToolCalls,
    writtenContentSegments,
    documentSession,
    writtenSections,
    harness,
    runMetrics,
    operationGroupId,
    runDuplicateGuard: true,
  });
  assertAnySectionWriteTransactions({
    section,
    toolResults: results,
    minCount: 1,
  });
  return results;
}

/** insert / replace / 幂等跳过 都算有效章节落盘。 */
function assertAnySectionWriteTransactions(params: {
  section: OutlineSection;
  toolResults: ToolCallResult[];
  minCount?: number;
}): void {
  const minCount = params.minCount ?? 1;
  const successfulWrites = params.toolResults.filter((result) => {
    if (!result.success) return false;
    if (result.name === "insert_at_anchor" || result.name === "replace_paragraph_range") {
      return true;
    }
    return typeof result.result === "string" && result.result.includes("跳过重复写入");
  });
  if (successfulWrites.length < minCount) {
    throw new AgentHarnessError(
      "tool_contract_violation",
      `章节 ${params.section.title} 需要至少 ${minCount} 次有效写入（insert/replace/跳过），实际 ${successfulWrites.length} 次。`,
      {
        agentId: "writer",
        details: {
          sectionId: params.section.id,
          successfulWriteCount: successfulWrites.length,
          toolResults: params.toolResults.map((result) => ({
            id: result.id,
            name: result.name,
            success: result.success,
            error: result.error,
          })),
        },
      },
    );
  }
}

/**
 * 先完整生成草稿（thinking 仍可通过 onChunk 流到 UI），再整章一次写入 Word。
 */
async function draftThenCommitSection(params: {
  outline: ArticleOutline;
  sectionIndex: number;
  section: OutlineSection;
  memoryContext: string;
  callbacks: OrchestratorCallbacks;
  executeToolCalls: TrackedToolExecutor;
  writtenContentSegments: string[];
  documentSession: DocumentSession;
  writtenSections: SectionWriteResult[];
  harness: AgentHarnessRuntime;
  runMetrics: RunMetricsDraft;
  runtimeOptions: RuntimeAgentOptions;
}): Promise<{ toolResults: ToolCallResult[]; rawDraft: string }> {
  const {
    outline,
    sectionIndex,
    section,
    memoryContext,
    callbacks,
    executeToolCalls,
    writtenContentSegments,
    documentSession,
    writtenSections,
    harness,
    runMetrics,
    runtimeOptions,
  } = params;

  const draft = await draftSection({
    outline,
    section,
    sectionIndex,
    memoryContext,
    isRunCancelled: callbacks.isRunCancelled,
    harness,
    aiOptions: runtimeOptions.writer,
    onChunk: callbacks.onChunk,
  });
  throwIfCancelled(callbacks);

  const sanitized = sanitizeSectionDraftContent(draft);
  if (!sanitized.trim()) {
    throw new AgentHarnessError(
      "state_contract_violation",
      `Writer 草稿为空：${section.title}`,
      { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
    );
  }

  const intended = ensureSectionWriteText(outline, sectionIndex, sanitized);
  const toolResults = await commitSectionText(
    intended,
    section,
    callbacks,
    executeToolCalls,
    writtenContentSegments,
    documentSession,
    writtenSections,
    harness,
    runMetrics,
  );

  return { toolResults, rawDraft: draft };
}

async function completeSectionAfterWrite(params: {
  outline: ArticleOutline;
  sectionIndex: number;
  section: OutlineSection;
  toolResults: ToolCallResult[];
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  memory: LongTermMemoryState;
  harness: AgentHarnessRuntime;
  documentSession: DocumentSession;
  runMetrics: RunMetricsDraft;
  flushState: ReturnType<typeof createSectionFlushState>;
  totalSections: number;
  onSectionPersisted?: () => Promise<void>;
}): Promise<void> {
  const {
    outline,
    sectionIndex,
    section,
    toolResults,
    callbacks,
    writtenSections,
    memory,
    harness,
    documentSession,
    runMetrics,
    flushState,
    totalSections,
    onSectionPersisted,
  } = params;

  const hasStructuredWrite = toolResults.some((result) =>
    result.success
    && (result.name === "insert_at_anchor" || result.name === "replace_paragraph_range")
    && Boolean(result.result && typeof result.result === "object" && (result.result as { transactionId?: unknown }).transactionId)
  );
  const onlySkippedDuplicates = !hasStructuredWrite && toolResults.some((result) =>
    result.success
    && typeof result.result === "string"
    && result.result.includes("跳过重复写入")
  );

  let transactionIds: string[] = [];
  let range: { rangeId: string; startParagraphIndex: number; endParagraphIndex: number; paragraphCount: number; text: string };

  const adoptByHeading = async (moment: string) => {
    const adopted = await documentSession.readSectionByHeading(
      harness,
      section,
      outline.sections[sectionIndex + 1],
      { phase: "writing", sectionId: section.id, moment },
    );
    runMetrics.rangeReadCount += 1;
    return adopted;
  };

  if (onlySkippedDuplicates) {
    // 幂等跳过：从标题 range 回收已有正文
    range = await adoptByHeading("adopt_existing_after_skip");
    runMetrics.duplicateWriteSkips += 1;
    transactionIds = [];
  } else {
    try {
      const resolved = await resolveWrittenSectionFromTransaction({
        session: documentSession,
        harness,
        section,
        nextSection: outline.sections[sectionIndex + 1],
        toolResults,
        metadata: { phase: "writing", sectionId: section.id, moment: "after_write" },
      });
      runMetrics.rangeReadCount += 1;
      transactionIds = resolved.transactionIds;
      range = resolved.range;
    } catch {
      // 写入可能已成功但 transaction 解析失败：回退标题 range，避免用户侧硬失败
      range = await adoptByHeading("adopt_existing_after_resolve_fallback");
      transactionIds = extractTransactionIdsFromResults(toolResults);
    }
  }

  const sectionContent = range.text.trim();
  if (!sectionContent) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `写入后无法在 Word 文档中定位章节内容：${section.title}`,
      { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
    );
  }

  updateWrittenSectionCache(
    writtenSections,
    section.id,
    section.title,
    sectionContent,
    toSectionWriteRange(range, transactionIds),
  );
  updateLongTermMemoryWithSection(memory, section, sectionContent);
  await flushAfterSectionIfDue({
    sectionLoopIndex: sectionIndex,
    totalSections,
    flushState,
    memory,
    onSectionPersisted,
  });

  callbacks.onSectionDone(sectionIndex, totalSections, section.title);
}

export async function runParallelDraftAndWrite(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  completedSectionIds?: Set<string>;
  memory: LongTermMemoryState;
  executeToolCalls: TrackedToolExecutor;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
  harness: AgentHarnessRuntime;
  documentSession: DocumentSession;
  runMetrics: RunMetricsDraft;
  onSectionPersisted?: () => Promise<void>;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
    completedSectionIds,
    memory,
    executeToolCalls,
    writtenContentSegments,
    runtimeOptions,
    harness,
    documentSession,
    runMetrics,
    onSectionPersisted,
  } = params;

  const total = outline.sections.length;
  const completed = completedSectionIds || new Set<string>();
  const alreadyDone = outline.sections.reduce(
    (count, section) => count + (completed.has(section.id) ? 1 : 0),
    0,
  );

  callbacks.onPhaseChange("writing", `草稿生成中（${alreadyDone}/${total}）...`);

  const flushState = createSectionFlushState();

  // 统一路径：并行草稿 → 按序整章一次落盘（不再中途流式分段写 Word）
  type ParallelProduceValue = { kind: "draft"; draft: string };

  await runParallelProduceOrderedCommit<ParallelProduceValue>({
    total,
    concurrency: runtimeOptions.parallelSectionConcurrency,
    isCancelled: () => callbacks.isRunCancelled(),
    cancelMessage: "章节写入流程已取消",
    produce: async (index) => {
      throwIfCancelled(callbacks);
      const section = outline.sections[index];
      if (completed.has(section.id)) {
        return null;
      }

      const memoryContext = buildMemoryContextForSection(memory, section);
      callbacks.onPhaseChange(
        "writing",
        `正在生成草稿 ${index + 1}/${total}：${section.title}`,
      );
      const draft = await draftSection({
        outline,
        section,
        sectionIndex: index,
        memoryContext,
        isRunCancelled: callbacks.isRunCancelled,
        harness,
        aiOptions: runtimeOptions.writer,
        onChunk: callbacks.onChunk,
      });
      if (!draft.trim()) {
        throw new AgentHarnessError(
          "state_contract_violation",
          `Writer 草稿为空：${section.title}`,
          { agentId: "writer", details: { sectionId: section.id, sectionIndex: index } },
        );
      }
      throwIfCancelled(callbacks);
      return { kind: "draft", draft };
    },
    onProduced: (index, value, progress) => {
      if (value === null) return;
      const section = outline.sections[index];
      if (index > progress.nextCommitIndex) {
        callbacks.onPhaseChange(
          "writing",
          `等待前序章节落盘：${section.title}（已写入 ${progress.written}/${total}）`,
        );
        return;
      }
      callbacks.onPhaseChange(
        "writing",
        `草稿生成中（${progress.drafted}/${total}）：${section.title}`,
      );
    },
    commit: async (index, value) => {
      throwIfCancelled(callbacks);
      const section = outline.sections[index];

      if (value === null || completed.has(section.id)) {
        callbacks.onSectionStart(index, total, section.title);
        callbacks.onSectionDone(index, total, section.title);
        return;
      }

      callbacks.onSectionStart(index, total, section.title);
      callbacks.onPhaseChange("writing", `正在写入 ${index + 1}/${total}：${section.title}`);

      const normalizedSectionText = ensureSectionWriteText(
        outline,
        index,
        sanitizeSectionDraftContent(value.draft),
      );
      if (!normalizedSectionText.trim()) {
        throw new AgentHarnessError(
          "state_contract_violation",
          `Writer 草稿为空：${section.title}`,
          { agentId: "writer", details: { sectionId: section.id, sectionIndex: index } },
        );
      }

      const toolResults = await commitSectionText(
        normalizedSectionText,
        section,
        callbacks,
        executeToolCalls,
        writtenContentSegments,
        documentSession,
        writtenSections,
        harness,
        runMetrics,
      );

      await completeSectionAfterWrite({
        outline,
        sectionIndex: index,
        section,
        toolResults,
        callbacks,
        writtenSections,
        memory,
        harness,
        documentSession,
        runMetrics,
        flushState,
        totalSections: total,
        onSectionPersisted,
      });
    },
    onAfterCommit: (_index, _value, progress) => {
      callbacks.onPhaseChange("writing", `已写入 ${progress.written}/${total}`);
    },
  });

  await flushSectionPersistenceIfPending(flushState, memory, onSectionPersisted);
}

export async function runSequentialSectionFlow(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  completedSectionIds?: Set<string>;
  memory: LongTermMemoryState;
  executeToolCalls: TrackedToolExecutor;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
  harness: AgentHarnessRuntime;
  documentSession: DocumentSession;
  runMetrics: RunMetricsDraft;
  onSectionPersisted?: () => Promise<void>;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
    completedSectionIds,
    memory,
    executeToolCalls,
    writtenContentSegments,
    runtimeOptions,
    harness,
    documentSession,
    runMetrics,
    onSectionPersisted,
  } = params;

  const total = outline.sections.length;
  const completed = completedSectionIds || new Set<string>();
  const flushState = createSectionFlushState();
  for (let i = 0; i < total; i++) {
    throwIfCancelled(callbacks);

    const section = outline.sections[i];
    if (completed.has(section.id)) {
      callbacks.onSectionStart(i, total, section.title);
      callbacks.onSectionDone(i, total, section.title);
      continue;
    }
    const memoryContext = buildMemoryContextForSection(memory, section);
    callbacks.onSectionStart(i, total, section.title);
    callbacks.onPhaseChange("writing", `正在撰写 ${i + 1}/${total}：${section.title}`);

    const committed = await draftThenCommitSection({
      outline,
      sectionIndex: i,
      section,
      memoryContext,
      callbacks,
      executeToolCalls,
      writtenContentSegments,
      documentSession,
      writtenSections,
      harness,
      runMetrics,
      runtimeOptions,
    });

    throwIfCancelled(callbacks);

    await completeSectionAfterWrite({
      outline,
      sectionIndex: i,
      section,
      toolResults: committed.toolResults,
      callbacks,
      writtenSections,
      memory,
      harness,
      documentSession,
      runMetrics,
      flushState,
      totalSections: total,
      onSectionPersisted,
    });
  }
  await flushSectionPersistenceIfPending(flushState, memory, onSectionPersisted);
}
