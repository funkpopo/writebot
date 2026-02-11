import { describe, expect, it } from "bun:test";
import { sanitizeFormatSpec } from "../utils";
import type { FormatSpecification } from "../../wordApi";

describe("sanitizeFormatSpec", () => {
  it("unifies paragraph line spacing across all paragraph types", () => {
    const formatSpec: FormatSpecification = {
      heading1: {
        font: { name: "黑体", size: 16, bold: true },
        paragraph: {
          lineSpacing: 2,
          lineSpacingRule: "multiple",
          spaceBefore: 18,
          spaceAfter: 10,
        },
      },
      bodyText: {
        font: { name: "宋体", size: 12 },
        paragraph: {
          lineSpacing: 1.5,
          lineSpacingRule: "multiple",
          spaceBefore: 6,
          spaceAfter: 4,
          firstLineIndent: 2,
        },
      },
      listItem: {
        font: { name: "宋体", size: 12 },
        paragraph: {
          lineSpacing: 24,
          lineSpacingRule: "exactly",
          spaceBefore: 3,
          spaceAfter: 3,
        },
      },
    };

    const sanitized = sanitizeFormatSpec(formatSpec);

    expect(sanitized.heading1?.paragraph.lineSpacing).toBe(1.5);
    expect(sanitized.bodyText?.paragraph.lineSpacing).toBe(1.5);
    expect(sanitized.listItem?.paragraph.lineSpacing).toBe(1.5);

    expect(sanitized.heading1?.paragraph.lineSpacingRule).toBe("multiple");
    expect(sanitized.bodyText?.paragraph.lineSpacingRule).toBe("multiple");
    expect(sanitized.listItem?.paragraph.lineSpacingRule).toBe("multiple");

    // 标题保留额外段距
    expect(sanitized.heading1?.paragraph.spaceBefore).toBe(18);
    expect(sanitized.heading1?.paragraph.spaceAfter).toBe(10);
    // 正文与列表固定为 0，避免相邻段落段距叠加
    expect(sanitized.bodyText?.paragraph.spaceBefore).toBe(0);
    expect(sanitized.bodyText?.paragraph.spaceAfter).toBe(0);
    expect(sanitized.listItem?.paragraph.spaceBefore).toBe(0);
    expect(sanitized.listItem?.paragraph.spaceAfter).toBe(0);
  });

  it("uses default heading spacing when AI omits heading paragraph spacing", () => {
    const formatSpec: FormatSpecification = {
      heading1: {
        font: { name: "黑体", size: 16, bold: true },
        paragraph: { firstLineIndent: 2 },
      },
      heading2: {
        font: { name: "黑体", size: 14, bold: true },
        paragraph: {},
      },
      bodyText: {
        font: { name: "宋体", size: 12 },
        paragraph: {},
      },
    };

    const sanitized = sanitizeFormatSpec(formatSpec);

    expect(sanitized.heading1?.paragraph.lineSpacing).toBe(1.5);
    expect(sanitized.bodyText?.paragraph.lineSpacing).toBe(1.5);
    expect(sanitized.heading1?.paragraph.lineSpacingRule).toBe("multiple");
    expect(sanitized.bodyText?.paragraph.lineSpacingRule).toBe("multiple");
    expect(sanitized.heading1?.paragraph.spaceBefore).toBe(16);
    expect(sanitized.heading1?.paragraph.spaceAfter).toBe(8);
    expect(sanitized.heading2?.paragraph.spaceBefore).toBe(12);
    expect(sanitized.heading2?.paragraph.spaceAfter).toBe(6);
    expect(sanitized.bodyText?.paragraph.spaceAfter).toBe(0);
  });
});
