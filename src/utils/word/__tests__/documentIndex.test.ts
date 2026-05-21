import { describe, expect, it } from "bun:test";
import {
  buildDocumentIndexFromParts,
  resolveDocumentReadRanges,
  type DocumentIndex,
} from "../documentIndex";
import type { ParagraphInfo } from "../types";

function paragraph(overrides: Partial<ParagraphInfo>): ParagraphInfo {
  return {
    index: overrides.index ?? 0,
    text: overrides.text ?? "",
    styleId: overrides.styleId,
    outlineLevel: overrides.outlineLevel,
    isListItem: overrides.isListItem ?? false,
    listLevel: overrides.listLevel,
    listString: overrides.listString,
    font: {},
    paragraph: {},
  };
}

function sampleIndex(): DocumentIndex {
  return buildDocumentIndexFromParts([
    paragraph({ index: 0, text: "Title", outlineLevel: 1, styleId: "Heading 1" }),
    paragraph({ index: 1, text: "Intro paragraph with a reasonably long body." }),
    paragraph({ index: 2, text: "Background", outlineLevel: 2, styleId: "Heading 2" }),
    paragraph({ index: 3, text: "First background paragraph." }),
    paragraph({ index: 4, text: "Second background paragraph." }),
    paragraph({ index: 5, text: "Methods", outlineLevel: 2, styleId: "Heading 2" }),
    paragraph({ index: 6, text: "Step one", isListItem: true, listLevel: 0, listString: "1." }),
  ]);
}

describe("documentIndex", () => {
  it("builds a lightweight index without full paragraph bodies", () => {
    const index = sampleIndex();

    expect(index.paragraphCount).toBe(7);
    expect(index.headingCount).toBe(3);
    expect(index.listItemCount).toBe(1);
    expect(index.headings[1].headingPath).toEqual(["Title", "Background"]);
    expect(index.lists[0].anchor.paragraphIndex).toBe(6);
    expect(index.paragraphs[1].preview?.length).toBeLessThanOrEqual(83);
    expect(index.paragraphs[1]).not.toHaveProperty("text");
  });

  it("resolves heading-path reads to the section boundary", () => {
    const ranges = resolveDocumentReadRanges(sampleIndex(), {
      headingPath: ["Title", "Background"],
    });

    expect(ranges).toEqual([{ start: 2, end: 4 }]);
  });

  it("merges and caps explicit ranges", () => {
    const ranges = resolveDocumentReadRanges(sampleIndex(), {
      ranges: [
        { start: 1, end: 2 },
        { start: 3, end: 6 },
      ],
      maxParagraphs: 4,
    });

    expect(ranges).toEqual([{ start: 1, end: 4 }]);
  });
});
