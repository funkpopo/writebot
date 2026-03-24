import { describe, expect, it } from "bun:test";
import { compressParagraphIndices, resolveUndoBlockTarget } from "../undoApi";
import type { ParagraphRangeUndoBlock } from "../types";

function makeUndoBlock(overrides?: Partial<ParagraphRangeUndoBlock>): ParagraphRangeUndoBlock {
  return {
    startIndex: 1,
    originalParagraphCount: 1,
    documentParagraphCountBefore: 4,
    documentParagraphCountAfter: 4,
    beforeAnchor: { expectedIndex: 0, text: "A" },
    afterAnchor: { expectedIndex: 2, text: "C" },
    rangeOoxml: "<w:p />",
    ...overrides,
  };
}

describe("compressParagraphIndices", () => {
  it("merges contiguous paragraph indices into compact ranges", () => {
    expect(compressParagraphIndices([5, 2, 3, 7, 8, 10, 3])).toEqual([
      { startIndex: 2, paragraphCount: 2 },
      { startIndex: 5, paragraphCount: 1 },
      { startIndex: 7, paragraphCount: 2 },
      { startIndex: 10, paragraphCount: 1 },
    ]);
  });
});

describe("resolveUndoBlockTarget", () => {
  it("resolves the current paragraph span between stable neighbor anchors", () => {
    const block = makeUndoBlock({
      documentParagraphCountAfter: 5,
    });

    const resolved = resolveUndoBlockTarget(["A", "B-1", "B-2", "C", "D"], block);
    expect(resolved.startIndex).toBe(1);
    expect(resolved.paragraphCount).toBe(2);
  });

  it("resolves insertions at the document start from the trailing anchor", () => {
    const block = makeUndoBlock({
      startIndex: 0,
      originalParagraphCount: 0,
      documentParagraphCountBefore: 3,
      documentParagraphCountAfter: 5,
      beforeAnchor: undefined,
      afterAnchor: { expectedIndex: 0, text: "A" },
    });

    const resolved = resolveUndoBlockTarget(["X", "Y", "A", "B", "C"], block);
    expect(resolved.startIndex).toBe(0);
    expect(resolved.paragraphCount).toBe(2);
  });

  it("resolves insertions at the document end from the leading anchor", () => {
    const block = makeUndoBlock({
      startIndex: 3,
      originalParagraphCount: 0,
      documentParagraphCountBefore: 3,
      documentParagraphCountAfter: 5,
      beforeAnchor: { expectedIndex: 2, text: "C" },
      afterAnchor: undefined,
    });

    const resolved = resolveUndoBlockTarget(["A", "B", "C", "X", "Y"], block);
    expect(resolved.startIndex).toBe(3);
    expect(resolved.paragraphCount).toBe(2);
  });

  it("falls back to the recorded start index when anchors are unavailable", () => {
    const block = makeUndoBlock({
      startIndex: 2,
      originalParagraphCount: 1,
      documentParagraphCountBefore: 5,
      documentParagraphCountAfter: 7,
      beforeAnchor: { expectedIndex: 1, text: "missing-before" },
      afterAnchor: { expectedIndex: 3, text: "missing-after" },
    });

    const resolved = resolveUndoBlockTarget(["A", "B", "X", "Y", "Z", "C", "D"], block);
    expect(resolved.startIndex).toBe(2);
    expect(resolved.paragraphCount).toBe(3);
  });
});
