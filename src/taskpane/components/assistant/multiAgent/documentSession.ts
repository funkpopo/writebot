import {
  getDocumentIndex,
  patchDocumentIndexRange,
  readDocumentRanges,
  type DocumentIndex,
  type DocumentIndexHeading,
  type DocumentIndexParagraph,
  type DocumentIndexRangePatch,
  type DocumentRangeReadResult,
  type ReadDocumentRangesInput,
} from "../../../../utils/wordApi";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";
import type { OutlineSection } from "./types";

const DEFAULT_MAX_RANGE_PARAGRAPHS = 120;
const PLANNER_PREVIEW_LIMIT = 10;

export interface DocumentIndexSummary {
  sessionId: string;
  indexVersion: number;
  paragraphCount: number;
  totalCharCount: number;
  headingCount: number;
  listItemCount: number;
  tableCount: number;
  headings: Array<{
    index: number;
    level: number;
    text: string;
    headingPath: string[];
  }>;
  previews: Array<{
    index: number;
    kind: string;
    preview: string;
    headingPath: string[];
  }>;
}

export interface DocumentSessionSnapshot {
  sessionId: string;
  indexVersion: number;
  paragraphCount: number;
  totalCharCount: number;
  headingCount: number;
  rangeCacheKeys: string[];
  dirtyRanges: Array<{ start: number; end: number; reason: string }>;
  lastMutationId?: string;
  createdAt: string;
  updatedAt: string;
}

export class DocumentSession {
  readonly sessionId: string;
  readonly createdAt: string;

  private index: DocumentIndex;
  private indexVersion = 1;
  private updatedAt: string;
  private headingMap = new Map<string, DocumentIndexHeading[]>();
  private rangeCache = new Map<string, DocumentRangeReadResult[]>();
  private dirtyRanges: Array<{ start: number; end: number; reason: string }> = [];
  private lastMutationId?: string;

  constructor(sessionId: string, index: DocumentIndex) {
    this.sessionId = sessionId;
    this.index = index;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.rebuildHeadingMap();
  }

  static async create(harness: AgentHarnessRuntime, metadata?: Record<string, unknown>): Promise<DocumentSession> {
    const event = harness.recordEvent({
      kind: "document_index_started",
      message: "Initializing Document Index Session",
      metadata,
    });
    try {
      const index = await getDocumentIndex();
      const session = new DocumentSession(
        `docsess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        index,
      );
      harness.completeEvent(event, {
        kind: "document_index_completed",
        metadata: {
          ...(metadata || {}),
          sessionId: session.sessionId,
          indexVersion: session.indexVersion,
          paragraphCount: index.paragraphCount,
          totalCharCount: index.totalCharCount,
          headingCount: index.headingCount,
        },
      });
      return session;
    } catch (error) {
      harness.completeEvent(event, {
        kind: "document_index_failed",
        metadata: {
          ...(metadata || {}),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new AgentHarnessError(
        "document_index_failed",
        `初始化 Document Index Session 失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error, details: metadata },
      );
    }
  }

  getIndex(): DocumentIndex {
    return this.index;
  }

  get paragraphCount(): number {
    return this.index.paragraphCount;
  }

  get totalCharCount(): number {
    return this.index.totalCharCount;
  }

  getHeadingMap(): ReadonlyMap<string, readonly DocumentIndexHeading[]> {
    return this.headingMap;
  }

  getLastParagraph(): DocumentIndexParagraph | null {
    return this.index.paragraphs[this.index.paragraphs.length - 1] || null;
  }

  getSnapshot(): DocumentSessionSnapshot {
    return {
      sessionId: this.sessionId,
      indexVersion: this.indexVersion,
      paragraphCount: this.index.paragraphCount,
      totalCharCount: this.index.totalCharCount,
      headingCount: this.index.headingCount,
      rangeCacheKeys: Array.from(this.rangeCache.keys()),
      dirtyRanges: [...this.dirtyRanges],
      lastMutationId: this.lastMutationId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  getSummary(): DocumentIndexSummary {
    const previews = this.index.paragraphs
      .filter((para) => para.preview?.trim())
      .slice(0, PLANNER_PREVIEW_LIMIT)
      .map((para) => ({
        index: para.index,
        kind: para.kind,
        preview: para.preview || "",
        headingPath: para.headingPath,
      }));

    return {
      sessionId: this.sessionId,
      indexVersion: this.indexVersion,
      paragraphCount: this.index.paragraphCount,
      totalCharCount: this.index.totalCharCount,
      headingCount: this.index.headingCount,
      listItemCount: this.index.listItemCount,
      tableCount: this.index.tableCount,
      headings: this.index.headings.map((heading) => ({
        index: heading.index,
        level: heading.level,
        text: heading.text,
        headingPath: heading.headingPath,
      })),
      previews,
    };
  }

  async refresh(
    harness: AgentHarnessRuntime,
    reason: string,
    patch?: DocumentIndexRangePatch,
  ): Promise<void> {
    if (!patch) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        "DocumentSession 局部刷新缺少明确 affected range，已阻断全文索引重建。",
        { details: { sessionId: this.sessionId, reason } },
      );
    }

    const dirtyRange = patch.afterRange || patch.beforeRange;
    this.dirtyRanges.push({ ...dirtyRange, reason });
    const event = harness.recordEvent({
      kind: "document_index_started",
      message: "Refreshing Document Index Session",
      metadata: {
        sessionId: this.sessionId,
        reason,
        beforeRange: patch.beforeRange,
        afterRange: patch.afterRange,
        paragraphCountAfter: patch.paragraphCountAfter,
        previousIndexVersion: this.indexVersion,
      },
    });
    try {
      this.index = await patchDocumentIndexRange(this.index, patch);
      this.indexVersion += 1;
      this.updatedAt = new Date().toISOString();
      this.lastMutationId = `${reason}_${this.indexVersion}`;
      this.dirtyRanges = this.dirtyRanges.filter((range) => range.reason !== reason);
      this.rebuildHeadingMap();
      this.rangeCache.clear();
      harness.completeEvent(event, {
        kind: "document_index_completed",
        metadata: {
          sessionId: this.sessionId,
          reason,
          indexVersion: this.indexVersion,
          refreshMode: "range_patch",
          beforeRange: patch.beforeRange,
          afterRange: patch.afterRange,
          paragraphCount: this.index.paragraphCount,
          totalCharCount: this.index.totalCharCount,
          headingCount: this.index.headingCount,
        },
      });
    } catch (error) {
      harness.completeEvent(event, {
        kind: "document_index_failed",
        metadata: {
          sessionId: this.sessionId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new AgentHarnessError(
        "document_range_unresolved",
        `局部刷新 Document Index Session 失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error, details: { sessionId: this.sessionId, reason, patch } },
      );
    }
  }

  async readRanges(
    harness: AgentHarnessRuntime,
    input: Omit<ReadDocumentRangesInput, "index">,
    metadata?: Record<string, unknown>,
  ): Promise<DocumentRangeReadResult[]> {
    const key = JSON.stringify({
      indexVersion: this.indexVersion,
      input,
    });
    const cached = this.rangeCache.get(key);
    if (cached) {
      harness.recordEvent({
        kind: "document_range_read_completed",
        message: "Document range cache hit",
        metadata: {
          ...(metadata || {}),
          sessionId: this.sessionId,
          indexVersion: this.indexVersion,
          rangeCount: cached.length,
          cacheHit: true,
        },
      });
      return cached;
    }

    const event = harness.recordEvent({
      kind: "document_range_read_started",
      message: "Reading indexed document ranges",
      metadata: {
        ...(metadata || {}),
        sessionId: this.sessionId,
        indexVersion: this.indexVersion,
      },
    });

    try {
      const result = await readDocumentRanges({
        ...input,
        index: this.index,
      });
      if (result.length === 0) {
        throw new AgentHarnessError(
          "document_range_unresolved",
          "无法根据 DocumentSession 定位局部读取范围",
          { details: { sessionId: this.sessionId, input, metadata } },
        );
      }
      this.rangeCache.set(key, result);
      harness.completeEvent(event, {
        kind: "document_range_read_completed",
        metadata: {
          ...(metadata || {}),
          sessionId: this.sessionId,
          indexVersion: this.indexVersion,
          rangeCount: result.length,
          paragraphCount: result.reduce((sum, range) => sum + range.paragraphCount, 0),
          chars: result.reduce((sum, range) => sum + range.text.length, 0),
          cacheHit: false,
        },
      });
      return result;
    } catch (error) {
      harness.completeEvent(event, {
        kind: "document_range_read_failed",
        metadata: {
          ...(metadata || {}),
          sessionId: this.sessionId,
          indexVersion: this.indexVersion,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (error instanceof AgentHarnessError) {
        throw error;
      }
      throw new AgentHarnessError(
        "document_range_unresolved",
        `局部读取范围失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error, details: { sessionId: this.sessionId, input, metadata } },
      );
    }
  }

  resolveSectionRange(
    sectionTitle: string,
    nextSectionTitle?: string,
  ): { start: number; end: number; heading?: { index: number; level: number } } | null {
    const startHeading = this.findHeadingLikeParagraphByTitle(sectionTitle);
    if (!startHeading) return null;
    const explicitNext = nextSectionTitle
      ? this.findHeadingLikeParagraphByTitle(nextSectionTitle, startHeading.index + 1)
      : null;
    const nextSibling = this.index.headings.find((heading) =>
      heading.index > startHeading.index && heading.level <= startHeading.level
    );
    const nextHeading = explicitNext && explicitNext.index > startHeading.index
      ? explicitNext
      : nextSibling;
    return {
      start: startHeading.index,
      end: nextHeading ? Math.max(startHeading.index, nextHeading.index - 1) : this.index.paragraphCount - 1,
      heading: startHeading,
    };
  }

  async readSectionByHeading(
    harness: AgentHarnessRuntime,
    section: OutlineSection,
    nextSection?: OutlineSection,
    metadata?: Record<string, unknown>,
  ): Promise<DocumentRangeReadResult> {
    const range = this.resolveSectionRange(section.title, nextSection?.title);
    if (!range) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        `无法定位章节范围：${section.title}`,
        { details: { sectionId: section.id, sectionTitle: section.title, nextSectionTitle: nextSection?.title } },
      );
    }
    const [result] = await this.readRanges(
      harness,
      {
        ranges: [{ start: range.start, end: range.end }],
        maxParagraphs: DEFAULT_MAX_RANGE_PARAGRAPHS,
      },
      {
        ...(metadata || {}),
        sectionId: section.id,
        sectionTitle: section.title,
      },
    );
    if (!result) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        `章节范围读取为空：${section.title}`,
        { details: { sectionId: section.id, range } },
      );
    }
    return result;
  }

  async readNearbyContext(
    harness: AgentHarnessRuntime,
    input: {
      paragraphIndex?: number;
      anchor?: { paragraphIndex?: number };
      searchResultId?: string;
      before?: number;
      after?: number;
    },
    metadata?: Record<string, unknown>,
  ): Promise<DocumentRangeReadResult[]> {
    const sourceIndex = input.paragraphIndex
      ?? input.anchor?.paragraphIndex
      ?? parseParagraphIndexFromId(input.searchResultId);
    if (sourceIndex === undefined || !Number.isFinite(sourceIndex)) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        "read_nearby_context 需要 paragraphIndex、anchor.paragraphIndex 或 searchResultId",
        { details: { input, metadata } },
      );
    }
    const before = Math.max(0, Math.floor(input.before ?? 3));
    const after = Math.max(0, Math.floor(input.after ?? 3));
    const start = Math.max(0, sourceIndex - before);
    const end = Math.min(Math.max(0, this.index.paragraphCount - 1), sourceIndex + after);
    return this.readRanges(
      harness,
      {
        ranges: [{ start, end }],
        maxParagraphs: before + after + 1,
      },
      metadata,
    );
  }

  searchIndex(query: string, options: { matchCase?: boolean; matchWholeWord?: boolean } = {}) {
    const needle = options.matchCase ? query.trim() : query.trim().toLowerCase();
    if (!needle) return [];
    const normalize = (value: string) => options.matchCase ? value : value.toLowerCase();
    const wordBoundary = options.matchWholeWord
      ? new RegExp(`(^|\\s)${escapeRegExp(needle)}($|\\s)`, options.matchCase ? "" : "i")
      : null;

    return this.index.paragraphs
      .filter((paragraph) => {
        const haystack = normalize([
          paragraph.preview || "",
          paragraph.headingPath.join(" "),
        ].join(" "));
        return wordBoundary ? wordBoundary.test(haystack) : haystack.includes(needle);
      })
      .slice(0, 20)
      .map((paragraph) => ({
        id: paragraph.anchor.anchorId,
        index: paragraph.index,
        preview: paragraph.preview || "",
        headingPath: paragraph.headingPath,
        anchor: paragraph.anchor,
      }));
  }

  private findHeadingByTitle(title: string, minIndex = 0): DocumentIndexHeading | null {
    const normalizedTitle = normalizeHeadingTitle(title);
    if (!normalizedTitle) return null;
    const exactCandidates = this.headingMap.get(normalizedTitle) || [];
    const candidates = exactCandidates.length > 0 ? exactCandidates.filter((heading) => heading.index >= minIndex) : this.index.headings.filter((heading) => {
      if (heading.index < minIndex) return false;
      const normalizedHeading = normalizeHeadingTitle(heading.text);
      return normalizedHeading === normalizedTitle
        || (normalizedHeading.includes(normalizedTitle) && normalizedHeading.length <= normalizedTitle.length + 8);
    });
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }

  private rebuildHeadingMap(): void {
    const next = new Map<string, DocumentIndexHeading[]>();
    for (const heading of this.index.headings) {
      const key = normalizeHeadingTitle(heading.text);
      if (!key) continue;
      const bucket = next.get(key) || [];
      bucket.push(heading);
      next.set(key, bucket);
    }
    this.headingMap = next;
  }

  private findHeadingLikeParagraphByTitle(title: string, minIndex = 0): { index: number; level: number } | null {
    const heading = this.findHeadingByTitle(title, minIndex);
    if (heading) return { index: heading.index, level: heading.level };

    const normalizedTitle = normalizeHeadingTitle(title);
    if (!normalizedTitle) return null;
    const candidates = this.index.paragraphs
      .map((paragraph) => {
        if (paragraph.index < minIndex) return null;
        const preview = paragraph.preview || "";
        const normalizedParagraph = normalizeHeadingTitle(preview);
        if (!normalizedParagraph) return null;
        const exact = normalizedParagraph === normalizedTitle;
        const loose = normalizedParagraph.includes(normalizedTitle)
          && normalizedParagraph.length <= normalizedTitle.length + 8;
        if (!exact && !loose) return null;
        const markdownLevel = getMarkdownHeadingLevel(preview);
        return {
          paragraph,
          exact,
          markdownLevel,
          isHeadingLike: paragraph.kind === "heading" || markdownLevel !== undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const preferred = candidates.find((item) => item.exact && item.isHeadingLike)
      || candidates.find((item) => item.exact)
      || candidates.find((item) => item.isHeadingLike)
      || candidates[0];
    return preferred
      ? {
        index: preferred.paragraph.index,
        level: preferred.paragraph.outlineLevel || preferred.markdownLevel || 1,
      }
      : null;
  }
}

function getMarkdownHeadingLevel(input: string): number | undefined {
  const match = input.trim().match(/^(#{1,6})\s+\S+/);
  if (!match) return undefined;
  return match[1].length;
}

function parseParagraphIndexFromId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^p(\d+)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHeadingTitle(input: string): string {
  return input
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\(?\d+[\).、:：\-\s]+/, "")
    .replace(/^第[0-9一二三四五六七八九十百零]+[章节部分篇][\s、:：\-.]+/, "")
    .replace(/[：:。．、,，;；!?！？"“”'‘’]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function renderDocumentIndexSummary(summary: DocumentIndexSummary): string {
  const lines: string[] = [];
  lines.push("## Document Index Session");
  lines.push(`sessionId: ${summary.sessionId}`);
  lines.push(`indexVersion: ${summary.indexVersion}`);
  lines.push(`paragraphCount: ${summary.paragraphCount}`);
  lines.push(`totalCharCount: ${summary.totalCharCount}`);
  lines.push(`headingCount: ${summary.headingCount}`);
  lines.push(`listItemCount: ${summary.listItemCount}`);
  lines.push(`tableCount: ${summary.tableCount}`);
  lines.push("");
  lines.push("## 标题索引");
  if (summary.headings.length === 0) {
    lines.push("（无标题）");
  } else {
    for (const heading of summary.headings) {
      lines.push(`- p${heading.index} / h${heading.level}: ${heading.headingPath.join(" > ") || heading.text}`);
    }
  }
  if (summary.previews.length > 0) {
    lines.push("");
    lines.push("## 局部预览");
    for (const preview of summary.previews) {
      lines.push(`- p${preview.index} [${preview.kind}] ${preview.preview}`);
    }
  }
  return lines.join("\n");
}
