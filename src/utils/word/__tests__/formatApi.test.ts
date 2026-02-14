import { describe, expect, it } from "bun:test";
import {
  buildParagraphStylePatch,
  type ParagraphFormatStateSnapshot,
} from "../formatApi";

describe("buildParagraphStylePatch", () => {
  it("returns no-op patch when current paragraph already matches target style", () => {
    const current: ParagraphFormatStateSnapshot = {
      fontName: "宋体",
      fontSize: 12,
      fontBold: false,
      fontItalic: false,
      fontColor: "#000000",
      firstLineIndent: 24,
      leftIndent: 0,
      lineSpacing: 21.6,
      spaceBefore: 0,
      spaceAfter: 0,
    };

    const patch = buildParagraphStylePatch(current, "bodyText", {
      font: {
        name: "宋体",
        size: 12,
        bold: false,
        color: "black",
      },
      paragraph: {
        lineSpacing: 1.5,
        lineSpacingRule: "multiple",
        firstLineIndent: 2,
        leftIndent: 0,
        spaceBefore: 0,
        spaceAfter: 0,
      },
    });

    expect(patch.hasChanges).toBe(false);
    expect(patch.font).toEqual({});
    expect(patch.paragraph).toEqual({});
  });

  it("only patches the fields that are actually different", () => {
    const current: ParagraphFormatStateSnapshot = {
      fontName: "宋体",
      fontSize: 12,
      fontBold: false,
      fontItalic: false,
      firstLineIndent: 0,
      leftIndent: 0,
      lineSpacing: 21.6,
      spaceBefore: 0,
      spaceAfter: 0,
    };

    const patch = buildParagraphStylePatch(current, "bodyText", {
      font: {
        name: "宋体",
        size: 12,
      },
      paragraph: {
        lineSpacing: 1.5,
        lineSpacingRule: "multiple",
        firstLineIndent: 2,
        leftIndent: 0,
        spaceBefore: 0,
        spaceAfter: 0,
      },
    });

    expect(patch.hasChanges).toBe(true);
    expect(patch.font).toEqual({});
    expect(patch.paragraph).toEqual({
      firstLineIndent: 24,
    });
  });

  it("forces heading indentation to zero when current value is non-zero", () => {
    const current: ParagraphFormatStateSnapshot = {
      fontName: "黑体",
      fontSize: 16,
      fontBold: true,
      firstLineIndent: 12,
      leftIndent: 6,
      lineSpacing: 28.8,
      spaceBefore: 16,
      spaceAfter: 8,
    };

    const patch = buildParagraphStylePatch(current, "heading1", {
      font: {
        name: "黑体",
        size: 16,
        bold: true,
      },
      paragraph: {
        lineSpacing: 1.5,
        lineSpacingRule: "multiple",
        spaceBefore: 16,
        spaceAfter: 8,
      },
    });

    expect(patch.hasChanges).toBe(true);
    expect(patch.paragraph).toEqual({
      firstLineIndent: 0,
      leftIndent: 0,
    });
  });
});
