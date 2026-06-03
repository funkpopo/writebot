import { describe, expect, it } from "bun:test";
import {
  buildDocumentIndexFromParts,
  hashIndexText,
  patchDocumentIndexRangeWithParagraphs,
  resolveDocumentReadRanges,
  type DocumentIndex,
} from "../documentIndex";
import { stableTextHash } from "../../documentText";
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

  it("uses the same text hash as edit transactions", () => {
    expect(hashIndexText("A  paragraph\r\nwith text")).toBe(stableTextHash("A  paragraph\r\nwith text"));
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

  it("patches inserted paragraph ranges without rebuilding from full paragraph bodies", () => {
    const index = buildDocumentIndexFromParts([
      paragraph({ index: 0, text: "Title", outlineLevel: 1, styleId: "Heading 1" }),
      paragraph({ index: 1, text: "Existing tail paragraph." }),
    ]);

    const patched = patchDocumentIndexRangeWithParagraphs(
      index,
      {
        beforeRange: { start: 1, end: 0 },
        afterRange: { start: 1, end: 2 },
        paragraphCountAfter: 4,
      },
      [
        paragraph({ index: 1, text: "Inserted Section", outlineLevel: 2, styleId: "Heading 2" }),
        paragraph({ index: 2, text: "Inserted body paragraph." }),
      ],
    );

    expect(patched.paragraphCount).toBe(4);
    expect(patched.headings.map((heading) => heading.text)).toEqual(["Title", "Inserted Section"]);
    expect(patched.paragraphs.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(patched.paragraphs[2].headingPath).toEqual(["Title", "Inserted Section"]);
    expect(patched.paragraphs[3].preview).toBe("Existing tail paragraph.");
  });

  it("patches deleted paragraph ranges and renumbers cached paragraphs", () => {
    const index = buildDocumentIndexFromParts([
      paragraph({ index: 0, text: "Title", outlineLevel: 1, styleId: "Heading 1" }),
      paragraph({ index: 1, text: "Removed Section", outlineLevel: 2, styleId: "Heading 2" }),
      paragraph({ index: 2, text: "Removed body paragraph." }),
      paragraph({ index: 3, text: "Remaining paragraph." }),
    ]);

    const patched = patchDocumentIndexRangeWithParagraphs(
      index,
      {
        beforeRange: { start: 1, end: 2 },
        paragraphCountAfter: 2,
      },
      [],
    );

    expect(patched.paragraphCount).toBe(2);
    expect(patched.headings.map((heading) => heading.text)).toEqual(["Title"]);
    expect(patched.paragraphs.map((item) => item.index)).toEqual([0, 1]);
    expect(patched.paragraphs[1].preview).toBe("Remaining paragraph.");
    expect(patched.paragraphs[1].headingPath).toEqual(["Title"]);
  });
});
