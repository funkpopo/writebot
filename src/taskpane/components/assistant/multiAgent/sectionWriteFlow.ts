import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import { editTransactionService } from "../../../../utils/editTransactionService";
import type { StreamCallback } from "../../../../utils/ai/types";
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
import {
  buildStreamingFlushOperationGroupId,
  computeStableFlushDelta,
  planFlushInserts,
  STREAM_FLUSH_MAX_PARAGRAPHS,
  STREAM_FLUSH_MIN_CHARS,
} from "./streamingParagraphFlush";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  OutlineSection,
  SectionWriteResult,
  SectionWriteRange,
} from "./types";
import { draftSection } from "./writerAgent";
import {
  assertWriteTransactions,
  buildInsertAtAnchorToolCall,
  checkDuplicateWriteGuard,
  throwIfDuplicateWriteBlocked,
} from "./writerWriteGuards";

export function updateWrittenSectionCache(
  writtenSections: SectionWriteResult[],
  sectionId: string,
  sectionTitle: string,
  content: string,
  sourceAnchors: string[] = [],
  range?: SectionWriteRange,
): void {
  const index = writtenSections.findIndex((item) => item.sectionId === sectionId);
  const previousRange = index >= 0 ? writtenSections[index].range : undefined;
  const next: SectionWriteResult = {
    sectionId,
    sectionTitle,
    content,
    sourceAnchors,
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
    if (duplicateGuard.status !== "clear") {
      runMetrics.duplicateWriteBlockedCount += 1;
    }
    throwIfDuplicateWriteBlocked({
      result: duplicateGuard,
      section,
      harness,
      mode: "new_section",
    });
    // Prefer stream-specific group id when provided; fingerprint id is used for
    // single-shot writes that pass the fingerprint group id as operationGroupId.
    resolvedGroupId = operationGroupId || duplicateGuard.fingerprint.operationGroupId;
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
 * Write a fully prepared section as paragraph batches (merge Word.run).
 * Used when draft is already complete (parallel commit path).
 */
async function insertSectionDraftInParagraphBatches(
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
  const streamToken = `batch_${Date.now().toString(36)}`;
  const { inserts } = planFlushInserts({
    delta: sectionContent,
    finalize: true,
    minChars: STREAM_FLUSH_MIN_CHARS,
    maxParagraphs: STREAM_FLUSH_MAX_PARAGRAPHS,
  });
  const chunks = inserts.length > 0 ? inserts : [sectionContent];
  const allResults: ToolCallResult[] = [];

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      throwIfCancelled(callbacks);
      const results = await insertSectionChunkAtAnchor({
        chunk: chunks[index],
        section,
        callbacks,
        executeToolCalls,
        writtenContentSegments,
        documentSession,
        writtenSections,
        harness,
        runMetrics,
        operationGroupId: buildStreamingFlushOperationGroupId(section.id, streamToken, index),
        runDuplicateGuard: index === 0,
      });
      allResults.push(...results);
    }
  } catch (error) {
    await rollbackChapterFlushTransactions(allResults);
    throw error;
  }

  assertWriteTransactions({
    section,
    toolResults: allResults,
    expectedToolName: "insert_at_anchor",
    minCount: 1,
  });
  return allResults;
}

interface StreamWriteSectionResult {
  toolResults: ToolCallResult[];
  rawDraft: string;
  writeMode: "stream_paragraph";
}

/**
 * Draft a section while flushing closed paragraphs to Word as they arrive.
 * Failure rolls back all flushed inserts for this chapter (章级回滚).
 */
async function draftAndStreamWriteSection(params: {
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
}): Promise<StreamWriteSectionResult> {
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

  const streamToken = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let raw = "";
  let written = "";
  let flushIndex = 0;
  let firstFlush = true;
  const toolResults: ToolCallResult[] = [];
  let flushChain: Promise<void> = Promise.resolve();
  let flushError: unknown;

  const appendFlushError = (error: unknown) => {
    if (!flushError) flushError = error;
  };

  const runFlush = async (finalize: boolean): Promise<void> => {
    if (flushError) return;
    throwIfCancelled(callbacks);

    const sanitized = sanitizeSectionDraftContent(raw);
    if (!sanitized.trim()) {
      if (finalize) {
        throw new AgentHarnessError(
          "state_contract_violation",
          `Writer 草稿为空：${section.title}`,
          { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
        );
      }
      return;
    }

    const intended = ensureSectionWriteText(outline, sectionIndex, sanitized);
    const { delta, stable } = computeStableFlushDelta({
      written,
      intended,
      finalize,
    });

    if (!stable) {
      if (!finalize) return;
      // Intended text drifted vs already-written prefix — chapter rollback then rewrite once.
      await rollbackChapterFlushTransactions(toolResults);
      toolResults.length = 0;
      written = "";
      flushIndex = 0;
      firstFlush = true;
      const rewriteResults = await insertSectionChunkAtAnchor({
        chunk: intended,
        section,
        callbacks,
        executeToolCalls,
        writtenContentSegments,
        documentSession,
        writtenSections,
        harness,
        runMetrics,
        operationGroupId: buildStreamingFlushOperationGroupId(section.id, streamToken, flushIndex),
        runDuplicateGuard: true,
      });
      toolResults.push(...rewriteResults);
      written = intended;
      flushIndex += 1;
      firstFlush = false;
      return;
    }

    const { inserts } = planFlushInserts({
      delta,
      finalize,
      minChars: STREAM_FLUSH_MIN_CHARS,
      maxParagraphs: STREAM_FLUSH_MAX_PARAGRAPHS,
      forceEmitAllReady: firstFlush && !finalize,
    });

    for (const insert of inserts) {
      if (!insert.trim()) continue;
      throwIfCancelled(callbacks);
      const results = await insertSectionChunkAtAnchor({
        chunk: insert,
        section,
        callbacks,
        executeToolCalls,
        writtenContentSegments,
        documentSession,
        writtenSections,
        harness,
        runMetrics,
        operationGroupId: buildStreamingFlushOperationGroupId(section.id, streamToken, flushIndex),
        runDuplicateGuard: firstFlush,
      });
      toolResults.push(...results);
      written += insert;
      flushIndex += 1;
      firstFlush = false;
    }
  };

  const scheduleFlush = (finalize: boolean): void => {
    flushChain = flushChain
      .then(() => runFlush(finalize))
      .catch((error) => {
        appendFlushError(error);
      });
  };

  const onChunk: StreamCallback = (chunk, done, isThinking, meta) => {
    callbacks.onChunk(chunk, done, isThinking, meta);
    if (done || !chunk || isThinking || meta?.kind === "tool_text") return;
    raw += chunk;
    scheduleFlush(false);
  };

  try {
    const draft = await draftSection({
      outline,
      section,
      sectionIndex,
      memoryContext,
      isRunCancelled: callbacks.isRunCancelled,
      harness,
      aiOptions: runtimeOptions.writer,
      onChunk,
    });
    raw = draft;
    await flushChain;
    if (flushError) throw flushError;
    await runFlush(true);

    if (!toolResults.length) {
      // Model returned content without paragraph boundaries mid-stream; finalize
      // path should have written, but guard anyway with a single insert.
      const intended = ensureSectionWriteText(outline, sectionIndex, sanitizeSectionDraftContent(draft));
      const results = await insertSectionChunkAtAnchor({
        chunk: intended,
        section,
        callbacks,
        executeToolCalls,
        writtenContentSegments,
        documentSession,
        writtenSections,
        harness,
        runMetrics,
        operationGroupId: buildStreamingFlushOperationGroupId(section.id, streamToken, flushIndex),
        runDuplicateGuard: true,
      });
      toolResults.push(...results);
    }

    assertWriteTransactions({
      section,
      toolResults,
      expectedToolName: "insert_at_anchor",
      minCount: 1,
    });

    return {
      toolResults,
      rawDraft: draft,
      writeMode: "stream_paragraph",
    };
  } catch (error) {
    await rollbackChapterFlushTransactions(toolResults);
    throw error;
  }
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

  const { transactionIds, range } = await resolveWrittenSectionFromTransaction({
    session: documentSession,
    harness,
    section,
    nextSection: outline.sections[sectionIndex + 1],
    toolResults,
    metadata: { phase: "writing", sectionId: section.id, moment: "after_write" },
  });
  runMetrics.rangeReadCount += 1;
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
    [],
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

  // First incomplete section streams paragraphs to Word while drafting (TTFR).
  // Later sections draft in parallel, then commit with paragraph-batched inserts.
  let firstIncompleteIndex = -1;
  for (let i = 0; i < total; i += 1) {
    if (!completed.has(outline.sections[i].id)) {
      firstIncompleteIndex = i;
      break;
    }
  }

  type ParallelProduceValue =
    | { kind: "stream_written"; toolResults: ToolCallResult[] }
    | { kind: "draft"; draft: string };

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

      if (index === firstIncompleteIndex) {
        callbacks.onSectionStart(index, total, section.title);
        callbacks.onPhaseChange(
          "writing",
          `流式撰写并落盘 ${index + 1}/${total}：${section.title}`,
        );
        const streamed = await draftAndStreamWriteSection({
          outline,
          sectionIndex: index,
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
        return { kind: "stream_written", toolResults: streamed.toolResults };
      }

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
      if (value.kind === "stream_written") {
        callbacks.onPhaseChange(
          "writing",
          `流式落盘完成，等待提交确认：${section.title}`,
        );
        return;
      }
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

      if (value.kind === "stream_written") {
        // Section start already fired during produce for the streaming head section.
        await completeSectionAfterWrite({
          outline,
          sectionIndex: index,
          section,
          toolResults: value.toolResults,
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
        return;
      }

      callbacks.onSectionStart(index, total, section.title);
      callbacks.onPhaseChange("writing", `正在写入 ${index + 1}/${total}：${section.title}`);

      if (!value.draft.trim()) {
        throw new AgentHarnessError(
          "state_contract_violation",
          `Writer 草稿为空：${section.title}`,
          { agentId: "writer", details: { sectionId: section.id, sectionIndex: index } },
        );
      }

      const normalizedSectionText = ensureSectionWriteText(outline, index, value.draft);
      const toolResults = await insertSectionDraftInParagraphBatches(
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
    callbacks.onPhaseChange("writing", `流式撰写并落盘 ${i + 1}/${total}：${section.title}`);

    const streamed = await draftAndStreamWriteSection({
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
      toolResults: streamed.toolResults,
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
