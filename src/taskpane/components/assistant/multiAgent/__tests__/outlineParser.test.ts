import { describe, expect, it } from "bun:test";
import { parseOutlineFromResponse } from "../outlineParser";

describe("outlineParser outline", () => {
  it("rejects planner payloads that omit required section fields", () => {
    const raw = JSON.stringify({
      title: "标题",
      theme: "主题",
      targetAudience: "读者",
      style: "风格",
      sections: [
        {
          id: "s1",
          title: "章节",
          level: 1,
          description: "描述",
          keyPoints: ["要点"],
        },
      ],
      totalEstimatedParagraphs: 1,
    });

    expect(() => parseOutlineFromResponse(raw)).toThrow("estimatedParagraphs");
  });

  it("parses a valid outline payload", () => {
    const raw = JSON.stringify({
      title: "标题",
      theme: "主题",
      targetAudience: "读者",
      style: "风格",
      sections: [
        {
          id: "s1",
          title: "章节",
          level: 1,
          description: "描述",
          keyPoints: ["要点"],
          estimatedParagraphs: 2,
        },
      ],
      totalEstimatedParagraphs: 2,
    });

    const parsed = parseOutlineFromResponse(raw);
    expect(parsed.title).toBe("标题");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.estimatedParagraphs).toBe(2);
  });
});
