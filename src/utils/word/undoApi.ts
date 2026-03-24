/* global Word */

import { getDocumentBodyOoxml, getDocumentOoxml, restoreDocumentOoxml } from "./documentApi";
import { type ParagraphAnchor, type ParagraphRangeUndoBlock, type UndoSnapshot } from "./types";

export interface ParagraphRangeSpec {
  startIndex: number;
  paragraphCount: number;
  description?: string;
}

function normalizeAnchorText(text?: string): string {
  return (text || "").trim();
}

export function compressParagraphIndices(indices: number[]): ParagraphRangeSpec[] {
  const sorted = Array.from(new Set(indices))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return [];
  }

  const ranges: ParagraphRangeSpec[] = [];
  let startIndex = sorted[0];
  let previousIndex = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const currentIndex = sorted[i];
    if (currentIndex === previousIndex + 1) {
      previousIndex = currentIndex;
      continue;
    }
    ranges.push({
      startIndex,
      paragraphCount: previousIndex - startIndex + 1,
    });
    startIndex = currentIndex;
    previousIndex = currentIndex;
  }

  ranges.push({
    startIndex,
    paragraphCount: previousIndex - startIndex + 1,
  });

  return ranges;
}

function clampParagraphRange(
  range: ParagraphRangeSpec,
  paragraphCount: number
): ParagraphRangeSpec {
  const maxStartIndex = Math.max(0, paragraphCount);
  const startIndex = Math.max(0, Math.min(range.startIndex, maxStartIndex));
  const paragraphCountLimit = Math.max(0, paragraphCount - startIndex);
  const normalizedCount = Math.max(0, Math.min(range.paragraphCount, paragraphCountLimit));
  return {
    startIndex,
    paragraphCount: normalizedCount,
    description: range.description,
  };
}

function findAnchorIndex(
  paragraphTexts: string[],
  anchor: ParagraphAnchor | undefined,
  direction: "backward" | "forward"
): number | null {
  if (!anchor || paragraphTexts.length === 0) {
    return null;
  }

  const expectedIndex = Math.max(0, Math.min(anchor.expectedIndex, paragraphTexts.length - 1));
  const anchorText = normalizeAnchorText(anchor.text);

  if (!anchorText) {
    return paragraphTexts[expectedIndex] !== undefined ? expectedIndex : null;
  }

  if (direction === "backward") {
    for (let index = expectedIndex; index >= 0; index--) {
      if (normalizeAnchorText(paragraphTexts[index]) === anchorText) {
        return index;
      }
    }
  } else {
    for (let index = expectedIndex; index < paragraphTexts.length; index++) {
      if (normalizeAnchorText(paragraphTexts[index]) === anchorText) {
        return index;
      }
    }
  }

  return null;
}

function getAppliedParagraphCount(block: ParagraphRangeUndoBlock): number {
  if (block.documentParagraphCountAfter === undefined) {
    return block.originalParagraphCount;
  }

  const delta = block.documentParagraphCountAfter - block.documentParagraphCountBefore;
  return Math.max(0, block.originalParagraphCount + delta);
}

export function resolveUndoBlockTarget(
  paragraphTexts: string[],
  block: ParagraphRangeUndoBlock
): {
  startIndex: number;
  paragraphCount: number;
  beforeAnchorIndex: number | null;
  afterAnchorIndex: number | null;
} {
  const beforeAnchorIndex = findAnchorIndex(paragraphTexts, block.beforeAnchor, "backward");
  const afterAnchorIndex = findAnchorIndex(paragraphTexts, block.afterAnchor, "forward");
  const appliedParagraphCount = getAppliedParagraphCount(block);
  const paragraphTotal = paragraphTexts.length;

  let startIndex = beforeAnchorIndex !== null ? beforeAnchorIndex + 1 : 0;
  let endExclusive = afterAnchorIndex !== null ? afterAnchorIndex : paragraphTotal;

  const anchorsConflict =
    beforeAnchorIndex !== null
    && afterAnchorIndex !== null
    && endExclusive < startIndex;

  if (anchorsConflict || (beforeAnchorIndex === null && afterAnchorIndex === null)) {
    startIndex = Math.max(0, Math.min(block.startIndex, paragraphTotal));
    endExclusive = Math.min(paragraphTotal, startIndex + appliedParagraphCount);
  }

  if (beforeAnchorIndex === null && afterAnchorIndex !== null) {
    startIndex = Math.max(0, afterAnchorIndex - appliedParagraphCount);
    endExclusive = afterAnchorIndex;
  }

  if (beforeAnchorIndex !== null && afterAnchorIndex === null) {
    startIndex = beforeAnchorIndex + 1;
    endExclusive = paragraphTotal;
  }

  let paragraphCount = Math.max(0, endExclusive - startIndex);

  if (paragraphCount === 0 && appliedParagraphCount > 0 && paragraphTotal > 0) {
    startIndex = Math.max(0, Math.min(block.startIndex, paragraphTotal - 1));
    paragraphCount = Math.min(appliedParagraphCount, paragraphTotal - startIndex);
  }

  return {
    startIndex,
    paragraphCount,
    beforeAnchorIndex,
    afterAnchorIndex,
  };
}

export async function captureDocumentUndoSnapshot(description?: string): Promise<UndoSnapshot> {
  const snapshot = await getDocumentOoxml();
  if (description) {
    snapshot.description = description;
  }
  return {
    kind: "document",
    createdAt: snapshot.createdAt,
    description,
    snapshot,
  };
}

export async function captureBodyUndoSnapshot(description?: string): Promise<UndoSnapshot> {
  const snapshot = await getDocumentBodyOoxml();
  if (description) {
    snapshot.description = description;
  }
  return {
    kind: "document",
    createdAt: snapshot.createdAt,
    description,
    snapshot,
  };
}

export async function captureScopedUndoSnapshotFromRanges(
  ranges: ParagraphRangeSpec[],
  description?: string
): Promise<UndoSnapshot> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const paragraphCount = paragraphs.items.length;
    const normalizedRanges = ranges.map((range) => clampParagraphRange(range, paragraphCount));
    const textLoadIndices = new Set<number>();
    const rangeResults: Array<OfficeExtension.ClientResult<string> | null> = [];

    for (const range of normalizedRanges) {
      if (range.startIndex > 0) {
        textLoadIndices.add(range.startIndex - 1);
      }
      if (range.startIndex + range.paragraphCount < paragraphCount) {
        textLoadIndices.add(range.startIndex + range.paragraphCount);
      }

      if (range.paragraphCount <= 0 || range.startIndex >= paragraphCount) {
        rangeResults.push(null);
        continue;
      }

      const endIndex = Math.min(paragraphCount - 1, range.startIndex + range.paragraphCount - 1);
      const startRange = paragraphs.items[range.startIndex].getRange();
      const targetRange =
        endIndex === range.startIndex
          ? startRange
          : startRange.expandTo(paragraphs.items[endIndex].getRange());
      rangeResults.push(targetRange.getOoxml());
    }

    for (const index of textLoadIndices) {
      paragraphs.items[index].load("text");
    }
    await context.sync();

    return {
      kind: "scoped" as const,
      createdAt: Date.now(),
      description,
      blocks: normalizedRanges.map((range, index) => {
        const beforeAnchorIndex = range.startIndex - 1;
        const afterAnchorIndex = range.startIndex + range.paragraphCount;
        return {
          startIndex: range.startIndex,
          originalParagraphCount: range.paragraphCount,
          documentParagraphCountBefore: paragraphCount,
          documentParagraphCountAfter: paragraphCount,
          rangeOoxml: rangeResults[index]?.value,
          beforeAnchor:
            beforeAnchorIndex >= 0 && beforeAnchorIndex < paragraphCount
              ? {
                expectedIndex: beforeAnchorIndex,
                text: paragraphs.items[beforeAnchorIndex].text,
              }
              : undefined,
          afterAnchor:
            afterAnchorIndex >= 0 && afterAnchorIndex < paragraphCount
              ? {
                expectedIndex: afterAnchorIndex,
                text: paragraphs.items[afterAnchorIndex].text,
              }
              : undefined,
          description: range.description,
        };
      }),
    };
  });
}

export async function captureScopedUndoSnapshotFromParagraphIndices(
  paragraphIndices: number[],
  description?: string
): Promise<UndoSnapshot> {
  return captureScopedUndoSnapshotFromRanges(
    compressParagraphIndices(paragraphIndices),
    description
  );
}

export function finalizeUndoSnapshot(
  snapshot: UndoSnapshot,
  paragraphCountAfter: number
): UndoSnapshot {
  if (snapshot.kind !== "scoped") {
    return snapshot;
  }

  return {
    ...snapshot,
    blocks: snapshot.blocks.map((block) => ({
      ...block,
      documentParagraphCountAfter: paragraphCountAfter,
    })),
  };
}

async function restoreScopedUndoBlock(block: ParagraphRangeUndoBlock): Promise<void> {
  await Word.run(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const paragraph of paragraphs.items) {
      paragraph.load("text");
    }
    await context.sync();

    const paragraphTexts = paragraphs.items.map((paragraph) => paragraph.text || "");
    const resolved = resolveUndoBlockTarget(paragraphTexts, block);

    if (block.originalParagraphCount === 0) {
      for (let index = resolved.startIndex + resolved.paragraphCount - 1; index >= resolved.startIndex; index--) {
        if (index >= 0 && index < paragraphs.items.length) {
          paragraphs.items[index].delete();
        }
      }
      await context.sync();
      return;
    }

    if (!block.rangeOoxml) {
      throw new Error("撤销快照缺少原始范围内容");
    }

    if (resolved.paragraphCount > 0 && resolved.startIndex < paragraphs.items.length) {
      const endIndex = resolved.startIndex + resolved.paragraphCount - 1;
      const startRange = paragraphs.items[resolved.startIndex].getRange();
      const targetRange =
        endIndex === resolved.startIndex
          ? startRange
          : startRange.expandTo(paragraphs.items[endIndex].getRange());
      targetRange.insertOoxml(block.rangeOoxml, Word.InsertLocation.replace);
      await context.sync();
      return;
    }

    if (
      resolved.beforeAnchorIndex !== null
      && resolved.beforeAnchorIndex >= 0
      && resolved.beforeAnchorIndex < paragraphs.items.length
    ) {
      paragraphs.items[resolved.beforeAnchorIndex]
        .getRange(Word.RangeLocation.whole)
        .insertOoxml(block.rangeOoxml, Word.InsertLocation.after);
      await context.sync();
      return;
    }

    if (
      resolved.afterAnchorIndex !== null
      && resolved.afterAnchorIndex >= 0
      && resolved.afterAnchorIndex < paragraphs.items.length
    ) {
      paragraphs.items[resolved.afterAnchorIndex]
        .getRange(Word.RangeLocation.whole)
        .insertOoxml(block.rangeOoxml, Word.InsertLocation.before);
      await context.sync();
      return;
    }

    body.insertOoxml(block.rangeOoxml, Word.InsertLocation.start);
    await context.sync();
  });
}

export async function restoreUndoSnapshot(snapshot: UndoSnapshot): Promise<void> {
  if (snapshot.kind === "document") {
    await restoreDocumentOoxml(snapshot.snapshot);
    return;
  }

  for (let index = snapshot.blocks.length - 1; index >= 0; index--) {
    await restoreScopedUndoBlock(snapshot.blocks[index]);
  }
}
