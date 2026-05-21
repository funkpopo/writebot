/* global Word */

import type { ParagraphInfo, SectionHeaderFooter } from "./types";
import { getAllParagraphsInfo } from "./paragraphApi";
import { getSectionHeadersFooters } from "./headerFooterApi";

const INDEX_TEXT_PREVIEW_LIMIT = 80;

export interface DocumentRangeAnchor {
  anchorId: string;
  paragraphIndex: number;
  paragraphTextHash: string;
  normalizedExcerpt: string;
  headingPath: string[];
  occurrence: number;
  beforeNeighborHash?: string;
  afterNeighborHash?: string;
}

export interface DocumentIndexParagraph {
  index: number;
  kind: "heading" | "list" | "table" | "body" | "empty";
  styleId?: string;
  outlineLevel?: number;
  headingPath: string[];
  listLevel?: number;
  listString?: string;
  charStart: number;
  charEnd: number;
  textLength: number;
  textHash: string;
  preview?: string;
  anchor: DocumentRangeAnchor;
}

export interface DocumentIndexHeading {
  index: number;
  level: number;
  text: string;
  headingPath: string[];
  anchor: DocumentRangeAnchor;
}

export interface DocumentIndexListItem {
  index: number;
  listLevel?: number;
  listString?: string;
  preview: string;
  anchor: DocumentRangeAnchor;
}

export interface DocumentIndexTableSummary {
  index: number;
  rowCount: number;
  columnCount: number;
  preview: string;
}

export interface DocumentIndexHeaderFooterSummary {
  sectionIndex: number;
  headerCharCount: number;
  footerCharCount: number;
  headerPreview?: string;
  footerPreview?: string;
}

export interface DocumentIndex {
  version: 1;
  createdAt: string;
  paragraphCount: number;
  totalCharCount: number;
  headingCount: number;
  listItemCount: number;
  tableCount: number;
  headerFooterCount: number;
  paragraphs: DocumentIndexParagraph[];
  headings: DocumentIndexHeading[];
  lists: DocumentIndexListItem[];
  tables: DocumentIndexTableSummary[];
  headersFooters: DocumentIndexHeaderFooterSummary[];
}

export interface DocumentRangeReadResult {
  rangeId: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
  paragraphCount: number;
  text: string;
  paragraphs: Array<{
    index: number;
    text: string;
    textHash: string;
    styleId?: string;
    outlineLevel?: number;
    isListItem: boolean;
    listLevel?: number;
    listString?: string;
    headingPath: string[];
    anchor: DocumentRangeAnchor;
  }>;
}

export interface ReadDocumentRangesInput {
  ranges?: Array<{ start: number; end?: number }>;
  paragraphIndices?: number[];
  headingPath?: string[];
  searchResultIds?: string[];
  maxParagraphs?: number;
}

export interface ReadNearbyContextInput {
  paragraphIndex?: number;
  anchor?: DocumentRangeAnchor;
  searchResultId?: string;
  before?: number;
  after?: number;
}

export function normalizeIndexText(value: string): string {
  return (value || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

export function hashIndexText(value: string): string {
  const normalized = normalizeIndexText(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function previewText(value: string, limit = INDEX_TEXT_PREVIEW_LIMIT): string {
  const normalized = normalizeIndexText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function isHeadingParagraph(para: ParagraphInfo): boolean {
  return para.outlineLevel !== undefined && para.outlineLevel >= 1 && para.outlineLevel <= 9;
}

function getParagraphKind(para: ParagraphInfo): DocumentIndexParagraph["kind"] {
  if (!normalizeIndexText(para.text)) return "empty";
  if (isHeadingParagraph(para)) return "heading";
  if (para.isListItem) return "list";
  return "body";
}

export function createParagraphAnchor(
  para: ParagraphInfo,
  headingPath: string[],
  occurrence: number,
  neighbors: { beforeText?: string; afterText?: string } = {}
): DocumentRangeAnchor {
  const paragraphTextHash = hashIndexText(para.text);
  return {
    anchorId: `p${para.index}_${paragraphTextHash}`,
    paragraphIndex: para.index,
    paragraphTextHash,
    normalizedExcerpt: previewText(para.text, 120),
    headingPath,
    occurrence,
    beforeNeighborHash: neighbors.beforeText === undefined ? undefined : hashIndexText(neighbors.beforeText),
    afterNeighborHash: neighbors.afterText === undefined ? undefined : hashIndexText(neighbors.afterText),
  };
}

export function buildDocumentIndexFromParts(
  paragraphs: ParagraphInfo[],
  tables: DocumentIndexTableSummary[] = [],
  headersFooters: SectionHeaderFooter[] = []
): DocumentIndex {
  const headingStack: string[] = [];
  const occurrences = new Map<string, number>();
  let charOffset = 0;
  const indexedParagraphs: DocumentIndexParagraph[] = [];
  const headings: DocumentIndexHeading[] = [];
  const lists: DocumentIndexListItem[] = [];

  for (let position = 0; position < paragraphs.length; position += 1) {
    const para = paragraphs[position];
    if (isHeadingParagraph(para)) {
      const level = Math.max(1, para.outlineLevel || 1);
      headingStack.length = Math.max(0, level - 1);
      headingStack[level - 1] = normalizeIndexText(para.text);
    }
    const headingPath = headingStack.filter(Boolean);
    const occurrenceKey = `${headingPath.join(">")}::${normalizeIndexText(para.text)}`;
    const occurrence = (occurrences.get(occurrenceKey) || 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const textLength = para.text?.length || 0;
    const anchor = createParagraphAnchor(para, headingPath, occurrence, {
      beforeText: paragraphs[position - 1]?.text,
      afterText: paragraphs[position + 1]?.text,
    });
    const indexed: DocumentIndexParagraph = {
      index: para.index,
      kind: getParagraphKind(para),
      styleId: para.styleId,
      outlineLevel: para.outlineLevel,
      headingPath,
      listLevel: para.listLevel,
      listString: para.listString,
      charStart: charOffset,
      charEnd: charOffset + textLength,
      textLength,
      textHash: anchor.paragraphTextHash,
      preview: previewText(para.text),
      anchor,
    };
    indexedParagraphs.push(indexed);

    if (indexed.kind === "heading" && para.outlineLevel !== undefined) {
      headings.push({
        index: para.index,
        level: para.outlineLevel,
        text: normalizeIndexText(para.text),
        headingPath,
        anchor,
      });
    } else if (indexed.kind === "list") {
      lists.push({
        index: para.index,
        listLevel: para.listLevel,
        listString: para.listString,
        preview: indexed.preview || "",
        anchor,
      });
    }

    charOffset += textLength + 1;
  }

  const headerFooterSummaries = headersFooters.map((section) => {
    const headerText = [
      section.header.primary,
      section.header.firstPage,
      section.header.evenPages,
    ].filter(Boolean).join("\n");
    const footerText = [
      section.footer.primary,
      section.footer.firstPage,
      section.footer.evenPages,
    ].filter(Boolean).join("\n");
    return {
      sectionIndex: section.sectionIndex,
      headerCharCount: headerText.length,
      footerCharCount: footerText.length,
      headerPreview: previewText(headerText),
      footerPreview: previewText(footerText),
    };
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    paragraphCount: paragraphs.length,
    totalCharCount: paragraphs.reduce((sum, para) => sum + (para.text?.length || 0), 0),
    headingCount: headings.length,
    listItemCount: lists.length,
    tableCount: tables.length,
    headerFooterCount: headerFooterSummaries.length,
    paragraphs: indexedParagraphs,
    headings,
    lists,
    tables,
    headersFooters: headerFooterSummaries,
  };
}

function clampRange(start: number, end: number, count: number): { start: number; end: number } | null {
  if (count <= 0) return null;
  const safeStart = Math.max(0, Math.min(count - 1, Math.floor(start)));
  const safeEnd = Math.max(0, Math.min(count - 1, Math.floor(end)));
  return {
    start: Math.min(safeStart, safeEnd),
    end: Math.max(safeStart, safeEnd),
  };
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }
  return merged;
}

export function resolveDocumentReadRanges(
  index: DocumentIndex,
  input: ReadDocumentRangesInput
): Array<{ start: number; end: number }> {
  const rawRanges: Array<{ start: number; end: number }> = [];
  for (const range of input.ranges || []) {
    const start = Number(range.start);
    const end = range.end === undefined ? start : Number(range.end);
    const clamped = clampRange(start, end, index.paragraphCount);
    if (clamped) rawRanges.push(clamped);
  }
  for (const paragraphIndex of input.paragraphIndices || []) {
    const clamped = clampRange(Number(paragraphIndex), Number(paragraphIndex), index.paragraphCount);
    if (clamped) rawRanges.push(clamped);
  }
  if (input.headingPath?.length) {
    const normalizedPath = input.headingPath.map(normalizeIndexText).filter(Boolean);
    const heading = index.headings.find((item) =>
      item.headingPath.length === normalizedPath.length
      && item.headingPath.every((part, idx) => part === normalizedPath[idx])
    );
    if (heading) {
      const nextHeading = index.headings.find((item) =>
        item.index > heading.index && item.level <= heading.level
      );
      rawRanges.push({
        start: heading.index,
        end: nextHeading ? nextHeading.index - 1 : index.paragraphCount - 1,
      });
    }
  }
  for (const searchResultId of input.searchResultIds || []) {
    const match = String(searchResultId).match(/^p(\d+)/i);
    if (!match) continue;
    const paragraphIndex = Number(match[1]);
    const clamped = clampRange(paragraphIndex, paragraphIndex, index.paragraphCount);
    if (clamped) rawRanges.push(clamped);
  }

  const maxParagraphs = Math.max(1, Math.floor(input.maxParagraphs || 80));
  let remaining = maxParagraphs;
  const limited: Array<{ start: number; end: number }> = [];
  for (const range of mergeRanges(rawRanges)) {
    if (remaining <= 0) break;
    const size = range.end - range.start + 1;
    const take = Math.min(size, remaining);
    limited.push({ start: range.start, end: range.start + take - 1 });
    remaining -= take;
  }
  return limited;
}

export async function getDocumentIndex(): Promise<DocumentIndex> {
  const [paragraphs, tables, headersFooters] = await Promise.all([
    getAllParagraphsInfo(),
    getDocumentTableSummaries(),
    getSectionHeadersFooters().catch(() => [] as SectionHeaderFooter[]),
  ]);
  return buildDocumentIndexFromParts(paragraphs, tables, headersFooters);
}

async function getDocumentTableSummaries(): Promise<DocumentIndexTableSummary[]> {
  return Word.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load("items");
    await context.sync();
    for (const table of tables.items) {
      table.load("rowCount, values");
    }
    await context.sync();
    return tables.items.map((table, index) => {
      const values = table.values || [];
      const firstRows = values.slice(0, 2).map((row) => row.join(" | ")).join("\n");
      return {
        index,
        rowCount: table.rowCount,
        columnCount: values[0]?.length || 0,
        preview: previewText(firstRows),
      };
    });
  });
}

export async function readDocumentRanges(input: ReadDocumentRangesInput): Promise<DocumentRangeReadResult[]> {
  const allParagraphs = await getAllParagraphsInfo();
  const index = buildDocumentIndexFromParts(allParagraphs);
  const indexByParagraph = new Map(index.paragraphs.map((item) => [item.index, item]));
  const ranges = resolveDocumentReadRanges(index, input);
  const output: DocumentRangeReadResult[] = [];
  for (const range of ranges) {
    const paragraphs = allParagraphs.filter((para) => para.index >= range.start && para.index <= range.end);
    output.push({
      rangeId: `p${range.start}-p${range.end}`,
      startParagraphIndex: range.start,
      endParagraphIndex: range.end,
      paragraphCount: paragraphs.length,
      text: paragraphs.map((para) => para.text).join("\n"),
      paragraphs: paragraphs.map((para) => {
        const indexed = indexByParagraph.get(para.index);
        return {
          index: para.index,
          text: para.text,
          textHash: hashIndexText(para.text),
          styleId: para.styleId,
          outlineLevel: para.outlineLevel,
          isListItem: para.isListItem,
          listLevel: para.listLevel,
          listString: para.listString,
          headingPath: indexed?.headingPath || [],
          anchor: indexed?.anchor || createParagraphAnchor(para, [], 1),
        };
      }),
    });
  }
  return output;
}

export async function readNearbyContext(input: ReadNearbyContextInput): Promise<DocumentRangeReadResult[]> {
  const index = await getDocumentIndex();
  const sourceIndex = input.paragraphIndex
    ?? input.anchor?.paragraphIndex
    ?? (input.searchResultId ? Number(String(input.searchResultId).match(/^p(\d+)/i)?.[1]) : undefined);
  if (sourceIndex === undefined || !Number.isFinite(sourceIndex)) {
    throw new Error("需要提供 paragraphIndex、anchor 或 searchResultId");
  }
  const before = Math.max(0, Math.floor(input.before ?? 3));
  const after = Math.max(0, Math.floor(input.after ?? 3));
  const clamped = clampRange(sourceIndex - before, sourceIndex + after, index.paragraphCount);
  if (!clamped) return [];
  return readDocumentRanges({ ranges: [clamped], maxParagraphs: before + after + 1 });
}
