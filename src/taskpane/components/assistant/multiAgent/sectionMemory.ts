export interface ResolveSectionContentParams {
  previousDocumentText: string;
  currentDocumentText: string;
  currentSectionTitle: string;
  nextSectionTitles: string[];
}

export interface ResolvedSectionContent {
  content: string;
  strategy: "heading" | "delta" | "document";
}

function normalizeLineForTitleMatch(input: string): string {
  return input
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\(?\d+[\).、:：\-\s]+/, "")
    .replace(/^第[0-9一二三四五六七八九十百零]+[章节部分篇]\s*/, "")
    .replace(/[：:。．、,，;；!?！？"“”'‘’]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isLikelyTitleMatch(line: string, sectionTitle: string): boolean {
  const normalizedLine = normalizeLineForTitleMatch(line);
  const normalizedTitle = normalizeLineForTitleMatch(sectionTitle);
  if (!normalizedLine || !normalizedTitle) return false;
  if (normalizedLine === normalizedTitle) return true;
  return normalizedLine.includes(normalizedTitle)
    && normalizedLine.length <= normalizedTitle.length + 8;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function extractSectionContentByHeadings(
  documentText: string,
  currentSectionTitle: string,
  nextSectionTitles: string[],
): string {
  const lines = splitLines(documentText);
  if (lines.length === 0) return "";

  const matchIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isLikelyTitleMatch(lines[i], currentSectionTitle)) {
      matchIndices.push(i);
    }
  }

  if (matchIndices.length === 0) {
    return "";
  }

  const headingMatchIndices = matchIndices.filter((index) => lines[index].trim().startsWith("#"));
  const startIndex = (headingMatchIndices.length > 0
    ? headingMatchIndices[headingMatchIndices.length - 1]
    : matchIndices[matchIndices.length - 1]);

  if (startIndex < 0) {
    return "";
  }

  let endIndex = lines.length;
  if (nextSectionTitles.length > 0) {
    for (let i = startIndex + 1; i < lines.length; i++) {
      const isNextSectionHeading = nextSectionTitles.some((title) =>
        isLikelyTitleMatch(lines[i], title)
      );
      if (isNextSectionHeading) {
        endIndex = i;
        break;
      }
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trim();
}

export function extractInsertedDelta(previousText: string, currentText: string): string {
  const prev = previousText || "";
  const curr = currentText || "";

  if (!curr.trim()) return "";
  if (!prev.trim()) return curr.trim();
  if (prev === curr) return "";

  const minLength = Math.min(prev.length, curr.length);
  let prefix = 0;
  while (prefix < minLength && prev[prefix] === curr[prefix]) {
    prefix += 1;
  }

  let prevTail = prev.length - 1;
  let currTail = curr.length - 1;
  while (prevTail >= prefix && currTail >= prefix && prev[prevTail] === curr[currTail]) {
    prevTail -= 1;
    currTail -= 1;
  }

  return curr.slice(prefix, currTail + 1).trim();
}

export function resolveSectionContent(params: ResolveSectionContentParams): ResolvedSectionContent {
  const {
    previousDocumentText,
    currentDocumentText,
    currentSectionTitle,
    nextSectionTitles,
  } = params;

  const byHeading = extractSectionContentByHeadings(
    currentDocumentText,
    currentSectionTitle,
    nextSectionTitles,
  );

  const byDelta = extractInsertedDelta(previousDocumentText, currentDocumentText);
  if (byHeading) {
    const headingTooShort = byHeading.length < 20;
    const deltaMuchLonger = byDelta.length > byHeading.length * 2;
    if (!(headingTooShort && deltaMuchLonger)) {
      return { content: byHeading, strategy: "heading" };
    }
  }

  if (byDelta) {
    return { content: byDelta, strategy: "delta" };
  }

  return {
    content: currentDocumentText.trim(),
    strategy: "document",
  };
}

export const __sectionMemoryInternals = {
  normalizeLineForTitleMatch,
  isLikelyTitleMatch,
};
