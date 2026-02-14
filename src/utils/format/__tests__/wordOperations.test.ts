import { describe, expect, it } from "bun:test";
import { buildTypographyWildcardRulePlan } from "../wordOperations";
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
