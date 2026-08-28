import { describe, expect, it } from "bun:test";
import { cloneOutline, validateAndNormalizeOutline } from "../outlineEditing";
import type { ArticleOutline } from "../types";

const baseOutline: ArticleOutline = {
  title: " 原标题 ",
  theme: " 原主题 ",
  targetAudience: " 普通读者 ",
  style: " 抒情 ",
  sections: [
    {
      id: "s1",
      title: " 第一章 ",
      level: 1,
      description: " 章节说明 ",
      keyPoints: ["- 要点一", "", " • 要点二 "],
      estimatedParagraphs: 3.6,
    },
    {
      id: "s1",
      title: "第二章",
      level: 9,
      description: "",
      keyPoints: [],
      estimatedParagraphs: 0,
    },
  ],
  totalEstimatedParagraphs: 99,
  promptContractHash: "prompt_contract",
  taskType: "create_article",
  primaryGoal: "写一篇文章",
  hardConstraints: ["保留约束"],
  outputRequirements: { language: "中文" },
  documentDependency: "none",
};

describe("outline editing", () => {
  it("clones nested arrays so form edits do not mutate planner output", () => {
    const cloned = cloneOutline(baseOutline);
    cloned.sections[0]!.keyPoints[0]! = "已修改";
    cloned.hardConstraints?.push("新约束");

    expect(baseOutline.sections[0]!.keyPoints[0]).toBe("- 要点一");
    expect(baseOutline.hardConstraints).toEqual(["保留约束"]);
  });

  it("normalizes edited content, recomputes totals, and preserves contract metadata", () => {
    const result = validateAndNormalizeOutline(baseOutline);

    expect(result.error).toBeUndefined();
    expect(result.outline?.title).toBe("原标题");
    expect(result.outline?.sections[0]!.keyPoints).toEqual(["要点一", "要点二"]);
    expect(result.outline?.sections[0]!.estimatedParagraphs).toBe(4);
    expect(result.outline?.sections[1]!.estimatedParagraphs).toBe(1);
    expect(result.outline?.sections[1]!.level).toBe(6);
    expect(result.outline?.sections[1]!.id).not.toBe("s1");
    expect(result.outline?.totalEstimatedParagraphs).toBe(5);
    expect(result.outline?.promptContractHash).toBe("prompt_contract");
    expect(result.outline?.hardConstraints).toEqual(["保留约束"]);
  });

  it("rejects empty required fields and an empty chapter list", () => {
    expect(validateAndNormalizeOutline({ ...baseOutline, title: " " }).error).toContain("文章标题");
    expect(validateAndNormalizeOutline({ ...baseOutline, sections: [] }).error).toContain("至少需要一个章节");
    expect(validateAndNormalizeOutline({
      ...baseOutline,
      sections: [{ ...baseOutline.sections[0]!, title: " " }],
    }).error).toContain("章节的标题");
  });
});
