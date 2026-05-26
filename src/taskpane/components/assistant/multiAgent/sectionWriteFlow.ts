import type { ToolCallRequest } from "../../../../types/tools";
import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import {
  createSectionFlushState,
  flushAfterSectionIfDue,
  flushSectionPersistenceIfPending,
} from "./checkpointRuntime";
import { safeGetDocumentText } from "./documentRuntime";
import { buildMemoryContextForSection, updateLongTermMemoryWithSection, type LongTermMemoryState } from "./longTermMemory";
import type { RuntimeAgentOptions } from "./runtimeOptions";
import type { TrackedToolExecutor } from "./runtimeTypes";
import { resolveSectionContent } from "./sectionMemory";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  SectionWriteResult,
} from "./types";
import { draftSection, writeSection } from "./writerAgent";

export function updateWrittenSectionCache(
  writtenSections: SectionWriteResult[],
  sectionId: string,
  sectionTitle: string,
  content: string,
  sourceAnchors: string[] = [],
): void {
  const index = writtenSections.findIndex((item) => item.sectionId === sectionId);
  if (index >= 0) {
    writtenSections[index] = { sectionId, sectionTitle, content, sourceAnchors };
    return;
  }
  writtenSections.push({ sectionId, sectionTitle, content, sourceAnchors });
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

async function appendSectionDraftToDocument(
  sectionContent: string,
  sectionId: string,
  callbacks: OrchestratorCallbacks,
  executeToolCalls: TrackedToolExecutor,
  writtenContentSegments: string[],
): Promise<void> {
  const toolCall: ToolCallRequest = {
    id: `parallel_append_${sectionId}_${Date.now().toString(36)}`,
    name: "append_text",
    arguments: { text: sectionContent },
  };

  callbacks.onToolCalls([toolCall]);
  const results = await executeToolCalls([toolCall], writtenContentSegments);
  const failed = results.find((item) => !item.success);
  if (failed) {
    throw new Error(failed.error || `章节 ${sectionId} 写入失败`);
  }
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
      if (callbacks.isRunCancelled()) return;
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
        aiOptions: runtimeOptions.writer,
      });
      if (callbacks.isRunCancelled()) return;
      draftedCount += 1;
      callbacks.onPhaseChange(
        "writing",
        `正在并行生成章节草稿（${draftedCount}/${total}）：${section.title}`
      );
    }
  });

  await Promise.all(workers);
  if (callbacks.isRunCancelled()) return;
  callbacks.onPhaseChange("writing", `草稿生成完成，开始写入文档（${draftedCount}/${total}）...`);

  const flushState = createSectionFlushState();
  let lastDocAfterWrite: string | null = null;
  for (let i = 0; i < outline.sections.length; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
    if (completed.has(section.id)) {
      lastDocAfterWrite = null;
      callbacks.onSectionStart(i, total, section.title);
      callbacks.onSectionDone(i, total, section.title);
      continue;
    }
    callbacks.onSectionStart(i, total, section.title);
    callbacks.onPhaseChange("writing", `正在写入 ${i + 1}/${total}：${section.title}`);

    const beforeWriteText = lastDocAfterWrite !== null
      ? lastDocAfterWrite
      : await safeGetDocumentText();
    const normalizedSectionText = ensureSectionWriteText(
      outline,
      i,
      drafts[i] || section.description || "",
    );
    await appendSectionDraftToDocument(
      normalizedSectionText,
      section.id,
      callbacks,
      executeToolCalls,
      writtenContentSegments,
    );

    const afterWriteText = await safeGetDocumentText(normalizedSectionText);
    lastDocAfterWrite = afterWriteText;
    const resolvedSectionContent = resolveSectionContent({
      previousDocumentText: beforeWriteText,
      currentDocumentText: afterWriteText,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(i + 1).map((item) => item.title),
    });
    const sectionContent = resolvedSectionContent.content.trim() || normalizedSectionText.trim();

    updateWrittenSectionCache(
      writtenSections,
      section.id,
      section.title,
      sectionContent,
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
    onSectionPersisted,
  } = params;

  const total = outline.sections.length;
  const completed = completedSectionIds || new Set<string>();
  const flushState = createSectionFlushState();
  let lastDocAfterWrite: string | null = null;
  for (let i = 0; i < total; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
    if (completed.has(section.id)) {
      lastDocAfterWrite = null;
      callbacks.onSectionStart(i, total, section.title);
      callbacks.onSectionDone(i, total, section.title);
      continue;
    }
    const memoryContext = buildMemoryContextForSection(memory, section);
    const sectionDocumentBeforeWrite = lastDocAfterWrite !== null
      ? lastDocAfterWrite
      : await safeGetDocumentText();
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
      memoryContext,
      aiOptions: runtimeOptions.writer,
    });
    const latestAssistantContent = result.assistantContent;

    if (callbacks.isRunCancelled()) return;

    const documentAfterSection = await safeGetDocumentText(latestAssistantContent);
    lastDocAfterWrite = documentAfterSection;
    const resolvedSectionContent = resolveSectionContent({
      previousDocumentText: sectionDocumentBeforeWrite,
      currentDocumentText: documentAfterSection,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(i + 1).map((item) => item.title),
    });
    const sectionContent = resolvedSectionContent.content.trim() || latestAssistantContent.trim();

    updateWrittenSectionCache(
      writtenSections,
      section.id,
      section.title,
      sectionContent,
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
