import { parseMarkdownWithTables, sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";

export interface ApplyPreviewSegment {
  id: string;
  kind: "text" | "table";
  rawContent: string;
  plainText: string;
}

export interface ApplyPreviewSource {
  content: string;
  applyContent?: string;
}

export interface ApplyPreviewSelectionSummary {
  totalCount: number;
  selectedCount: number;
  rejectedCount: number;
}

function normalizePreviewSource(input: string): string {
  return (typeof input === "string" ? input : String(input ?? ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function resolveApplyPreviewSource(source: ApplyPreviewSource): string {
  const preferred =
    typeof source.applyContent === "string" && source.applyContent.trim()
      ? source.applyContent
      : source.content;

  return normalizePreviewSource(preferred);
}

function trimBlankLines(input: string): string {
  const normalized = input
    .replace(/^(?:[ \t]*\n)+/u, "")
    .replace(/(?:\n[ \t]*)+$/u, "");

  return normalized.trim() ? normalized : "";
}

function isStandaloneHeading(block: string): boolean {
  const lines = trimBlankLines(block)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length === 1 && /^#{1,6}\s+\S/.test(lines[0]);
}

function splitTextPreviewBlocks(text: string): string[] {
  const normalized = normalizePreviewSource(text);
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    const block = trimBlankLines(current.join("\n"));
    if (block) {
      blocks.push(block);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      current.push(line);
      continue;
    }

    if (!inCodeFence && !trimmed) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();

  const mergedBlocks: string[] = [];
  for (const block of blocks) {
    const previous = mergedBlocks[mergedBlocks.length - 1];
    if (previous && isStandaloneHeading(previous)) {
      mergedBlocks[mergedBlocks.length - 1] = `${previous}\n\n${block}`;
      continue;
    }
    mergedBlocks.push(block);
  }

  return mergedBlocks;
}

export function buildApplyPreviewSegments(content: string): ApplyPreviewSegment[] {
  const normalized = normalizePreviewSource(content);
  if (!normalized) return [];

  const sourceLines = normalized.split("\n");
  const parsed = parseMarkdownWithTables(normalized);
  const segments: ApplyPreviewSegment[] = [];

  let segmentIndex = 0;
  const pushSegment = (kind: "text" | "table", rawContent: string) => {
    const trimmed = trimBlankLines(rawContent);
    if (!trimmed) return;

    segmentIndex += 1;
    segments.push({
      id: `segment_${segmentIndex}`,
      kind,
      rawContent: trimmed,
      plainText: sanitizeMarkdownToPlainText(trimmed),
    });
  };

  for (const segment of parsed.segments) {
    if (segment.type === "table") {
      pushSegment(
        "table",
        sourceLines.slice(segment.data.startIndex, segment.data.endIndex + 1).join("\n"),
      );
      continue;
    }

    for (const block of splitTextPreviewBlocks(segment.content)) {
      pushSegment("text", block);
    }
  }

  return segments;
}

export function createDefaultApplyPreviewSelection(
  segments: ApplyPreviewSegment[],
): Set<string> {
  return new Set(segments.map((segment) => segment.id));
}

export function summarizeApplyPreviewSelection(
  segments: ApplyPreviewSegment[],
  includedSegmentIds: Iterable<string>,
): ApplyPreviewSelectionSummary {
  const includedSet = new Set(includedSegmentIds);
  const selectedCount = segments.filter((segment) => includedSet.has(segment.id)).length;

  return {
    totalCount: segments.length,
    selectedCount,
    rejectedCount: Math.max(0, segments.length - selectedCount),
  };
}

export function mergeApplyPreviewSegments(
  segments: ApplyPreviewSegment[],
  includedSegmentIds: Iterable<string>,
): string {
  const includedSet = new Set(includedSegmentIds);
  return segments
    .filter((segment) => includedSet.has(segment.id))
    .map((segment) => trimBlankLines(segment.rawContent))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
