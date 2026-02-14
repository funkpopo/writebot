import { describe, expect, it } from "bun:test";
import {
  buildTypographyWildcardRulePlan,
  hasSensitiveTypographyContent,
} from "../wordOperations";
import type { TypographyOptions } from "../types";

const spacingAndPunctuation: TypographyOptions = {
  chineseFont: "宋体",
  englishFont: "Times New Roman",
  enforceSpacing: true,
  enforcePunctuation: true,
};

describe("buildTypographyWildcardRulePlan", () => {
  it("selects only rules that match the paragraph text", () => {
    const text = "中A A中 1A 2 年 中， 空格 a ,b 中?";
    const plan = buildTypographyWildcardRulePlan(text, spacingAndPunctuation);
    const ruleIds = plan.map((item) => item.id);

    expect(ruleIds).toEqual([
      "cjk-latin-spacing",
      "latin-cjk-spacing",
      "digit-latin-spacing",
      "digit-unit-compact",
      "cjk-punctuation-no-tail-space",
      "en-punctuation-no-leading-space",
      "cjk-en-punctuation-map",
    ]);
  });

  it("respects option switches and excludes disabled rule groups", () => {
    const punctuationOnly: TypographyOptions = {
      ...spacingAndPunctuation,
      enforceSpacing: false,
    };
    const text = "中A A中 1A 2 年 中， 空格 a ,b 中?";
    const plan = buildTypographyWildcardRulePlan(text, punctuationOnly);
    const ruleIds = plan.map((item) => item.id);

    expect(ruleIds).toEqual([
      "cjk-punctuation-no-tail-space",
      "en-punctuation-no-leading-space",
      "cjk-en-punctuation-map",
    ]);
  });

  it("returns empty plan for already normalized text", () => {
    const text = "中文 A 和 A 中文，标点无多余空格。";
    const plan = buildTypographyWildcardRulePlan(text, spacingAndPunctuation);
    expect(plan).toEqual([]);
  });
});

describe("hasSensitiveTypographyContent", () => {
  it("detects code and markdown link fragments", () => {
    expect(hasSensitiveTypographyContent("示例 `const a=1` 内容")).toBe(true);
    expect(hasSensitiveTypographyContent("请访问 [文档](https://example.com) 获取详情")).toBe(true);
  });

  it("detects URL and field-like fragments", () => {
    expect(hasSensitiveTypographyContent("链接 https://example.com/path?a=1")).toBe(true);
    expect(hasSensitiveTypographyContent("第 { PAGE } 页")).toBe(true);
  });

  it("returns false for regular plain text", () => {
    expect(hasSensitiveTypographyContent("这是普通文本 A 与中文混排。")).toBe(false);
  });
});
