import { describe, expect, it } from "bun:test";
import { analyzeDocumentQuality } from "../documentQuality";
import { buildDocumentIndexFromParts } from "../documentIndex";
import type { ParagraphInfo } from "../types";

function paragraph(overrides: Partial<ParagraphInfo>): ParagraphInfo {
  return { index: overrides.index ?? 0, text: overrides.text ?? "", styleId: overrides.styleId,
    outlineLevel: overrides.outlineLevel, isListItem: overrides.isListItem ?? false,
    listLevel: overrides.listLevel, listString: overrides.listString, font: {}, paragraph: {} };
}

describe("analyzeDocumentQuality", () => {
  it("reports actionable structural issues without retaining full paragraph text", () => {
    const index = buildDocumentIndexFromParts([
      paragraph({ index: 0, text: "Introduction", outlineLevel: 1, styleId: "Heading 1" }),
      paragraph({ index: 1, text: "" }),
      paragraph({ index: 2, text: "" }),
      paragraph({ index: 3, text: "Deep topic", outlineLevel: 3, styleId: "Heading 3" }),
      paragraph({ index: 4, text: "x".repeat(801) }),
      paragraph({ index: 5, text: "Deep topic", outlineLevel: 3, styleId: "Custom Heading" }),
    ]);

    const report = analyzeDocumentQuality(index);
    expect(report.summary.warningCount).toBeGreaterThanOrEqual(2);
    expect(report.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      "empty_paragraph_run", "heading_level_jump", "long_paragraph", "duplicate_heading", "heading_style_inconsistency",
    ]));
    expect(report.issues.find((issue) => issue.kind === "long_paragraph")?.paragraphIndices).toEqual([4]);
  });
});
