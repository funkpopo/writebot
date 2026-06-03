import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import {
  createSectionFlushState,
  flushAfterSectionIfDue,
  flushSectionPersistenceIfPending,
} from "./checkpointRuntime";
import { resolveWrittenSectionFromTransaction } from "./documentRuntime";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";
import type { DocumentSession } from "./documentSession";
import { buildMemoryContextForSection, updateLongTermMemoryWithSection, type LongTermMemoryState } from "./longTermMemory";
import type { RuntimeAgentOptions } from "./runtimeOptions";
import type { RunMetricsDraft, TrackedToolExecutor } from "./runtimeTypes";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  SectionWriteResult,
  SectionWriteRange,
} from "./types";
import { draftSection, writeSection } from "./writerAgent";

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

async function insertSectionDraftAtAnchor(
  sectionContent: string,
  sectionId: string,
  callbacks: OrchestratorCallbacks,
  executeToolCalls: TrackedToolExecutor,
  writtenContentSegments: string[],
  documentSession: DocumentSession,
): Promise<ToolCallResult[]> {
  const lastParagraph = documentSession.getLastParagraph();
  if (!lastParagraph) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      "无法定位文档末尾锚点，已阻断章节写入",
      { agentId: "writer", details: { sectionId } },
    );
  }

  const toolCall: ToolCallRequest = {
    id: `parallel_insert_${sectionId}_${Date.now().toString(36)}`,
    name: "insert_at_anchor",
    arguments: {
      text: sectionContent,
      contentFormat: "markdown",
      expectedBefore: {
        paragraphIndex: lastParagraph.index,
        anchor: lastParagraph.anchor,
        paragraphTextHash: lastParagraph.textHash,
        expectedTextExcerpt: lastParagraph.preview,
        headingPath: lastParagraph.headingPath,
      },
    },
  };

  callbacks.onToolCalls([toolCall]);
  const results = await executeToolCalls([toolCall], writtenContentSegments);
  const failed = results.find((item) => !item.success);
  if (failed) {
    throw new AgentHarnessError(
      "tool_batch_failed",
      failed.error || `章节 ${sectionId} 写入失败`,
      {
        agentId: "writer",
        details: {
          sectionId,
          failedTool: failed.name,
          failedToolId: failed.id,
        },
      },
    );
  }
  return results;
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
  let draftedCount = outline.sections.reduce(
    (count, section) => count + (completed.has(section.id) ? 1 : 0),
    0,
  );

  callbacks.onPhaseChange("writing", `正在并行生成章节草稿（${draftedCount}/${total}）...`);

  const drafts = new Array<string>(total).fill("");
  let cursor = 0;

  const workerCount = Math.min(total, runtimeOptions.parallelSectionConcurrency);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      throwIfCancelled(callbacks);
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= total) return;

      const section = outline.sections[currentIndex];
      if (completed.has(section.id)) {
        drafts[currentIndex] = "";
        continue;
      }
      const memoryContext = buildMemoryContextForSection(memory, section);
      drafts[currentIndex] = await draftSection({
        outline,
        section,
        sectionIndex: currentIndex,
        memoryContext,
        isRunCancelled: callbacks.isRunCancelled,
        harness,
        aiOptions: runtimeOptions.writer,
      });
      if (!drafts[currentIndex].trim()) {
        throw new AgentHarnessError(
          "state_contract_violation",
          `Writer 草稿为空：${section.title}`,
          { agentId: "writer", details: { sectionId: section.id, sectionIndex: currentIndex } },
        );
      }
      throwIfCancelled(callbacks);
      draftedCount += 1;
      callbacks.onPhaseChange(
        "writing",
        `正在并行生成章节草稿（${draftedCount}/${total}）：${section.title}`
      );
    }
  });

  await Promise.all(workers);
  throwIfCancelled(callbacks);
  callbacks.onPhaseChange("writing", `草稿生成完成，开始写入文档（${draftedCount}/${total}）...`);

  const flushState = createSectionFlushState();
  for (let i = 0; i < outline.sections.length; i++) {
    throwIfCancelled(callbacks);

    const section = outline.sections[i];
    if (completed.has(section.id)) {
      callbacks.onSectionStart(i, total, section.title);
      callbacks.onSectionDone(i, total, section.title);
      continue;
    }
    callbacks.onSectionStart(i, total, section.title);
    callbacks.onPhaseChange("writing", `正在写入 ${i + 1}/${total}：${section.title}`);

    if (!drafts[i].trim()) {
      throw new AgentHarnessError(
        "state_contract_violation",
        `Writer 草稿为空：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex: i } },
      );
    }
    const normalizedSectionText = ensureSectionWriteText(
      outline,
      i,
      drafts[i],
    );
    const toolResults = await insertSectionDraftAtAnchor(
      normalizedSectionText,
      section.id,
      callbacks,
      executeToolCalls,
      writtenContentSegments,
      documentSession,
    );

    const { transactionIds, range } = await resolveWrittenSectionFromTransaction({
      session: documentSession,
      harness,
      section,
      nextSection: outline.sections[i + 1],
      toolResults,
      metadata: { phase: "writing", sectionId: section.id, moment: "after_write" },
    });
    runMetrics.rangeReadCount += 1;
    const sectionContent = range.text.trim();
    if (!sectionContent) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        `写入后无法在 Word 文档中定位章节内容：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex: i } },
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
      sectionLoopIndex: i,
      totalSections: outline.sections.length,
      flushState,
      memory,
      onSectionPersisted,
    });

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }
    callbacks.onSectionDone(i, total, section.title);
  }
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

    const result = await writeSection({
      outline,
      section,
      sectionIndex: i,
      previousSections: writtenSections,
      allTools: TOOL_DEFINITIONS,
      onChunk: callbacks.onChunk,
      executeToolCalls,
      writtenContentSegments,
      isRunCancelled: callbacks.isRunCancelled,
      harness,
      memoryContext,
      aiOptions: runtimeOptions.writer,
    });
    const latestAssistantContent = result.assistantContent;
    if (!latestAssistantContent.trim()) {
      throw new AgentHarnessError(
        "state_contract_violation",
        `Writer 未返回章节内容：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex: i } },
      );
    }

    throwIfCancelled(callbacks);

    const { transactionIds, range } = await resolveWrittenSectionFromTransaction({
      session: documentSession,
      harness,
      section,
      nextSection: outline.sections[i + 1],
      toolResults: result.toolResults,
      metadata: { phase: "writing", sectionId: section.id, moment: "after_write" },
    });
    runMetrics.rangeReadCount += 1;
    const sectionContent = range.text.trim();
    if (!sectionContent) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        `写入后无法在 Word 文档中定位章节内容：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex: i } },
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
      sectionLoopIndex: i,
      totalSections: total,
      flushState,
      memory,
      onSectionPersisted,
    });

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }
    callbacks.onSectionDone(i, total, section.title);
  }
  await flushSectionPersistenceIfPending(flushState, memory, onSectionPersisted);
}
