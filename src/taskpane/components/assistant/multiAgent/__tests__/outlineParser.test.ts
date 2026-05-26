import { describe, expect, it } from "bun:test";
import { parseOutlineFromResponse, parseReviewFeedback, parseVerificationFeedback } from "../outlineParser";

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
});

describe("outlineParser verification", () => {
  it("parses verification payload and keeps pass verdict", () => {
    const raw = JSON.stringify({
      verdict: "pass",
      claims: [
        {
          claim: "结论 A",
          verdict: "pass",
          evidenceIds: ["e1"],
          sourceAnchors: ["p2"],
        },
      ],
      evidence: [
        {
          id: "e1",
          quote: "这是证据片段",
          anchor: "p2",
        },
      ],
    });
    const parsed = parseVerificationFeedback(raw);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.evidence).toHaveLength(1);
  });

  it("forces fail when claim has no source anchors", () => {
    const raw = JSON.stringify({
      verdict: "pass",
      claims: [
        {
          claim: "结论 B",
          verdict: "pass",
          evidenceIds: [],
          sourceAnchors: [],
        },
      ],
      evidence: [],
    });
    const parsed = parseVerificationFeedback(raw);
    expect(parsed.verdict).toBe("fail");
    expect(parsed.claims[0]?.verdict).toBe("fail");
  });

  it("rejects invalid verification verdicts instead of normalizing them", () => {
    const raw = JSON.stringify({
      verdict: "unknown",
      claims: [],
      evidence: [],
    });

    expect(() => parseVerificationFeedback(raw)).toThrow("verification.verdict");
  });
});

describe("outlineParser review", () => {
  it("parses review JSON wrapped with explanation text", () => {
    const raw = `这是审阅结果：
\`\`\`json
{
  "round": 1,
  "overallScore": 8,
  "sectionFeedback": [
    {
      "sectionId": "s1",
      "issues": ["问题1"],
      "suggestions": ["建议1"],
      "needsRevision": false
    }
  ],
  "coherenceIssues": [],
  "globalSuggestions": []
}
\`\`\``;
    const parsed = parseReviewFeedback(raw, 1);
    expect(parsed.overallScore).toBe(8);
    expect(parsed.sectionFeedback).toHaveLength(1);
    expect(parsed.sectionFeedback[0]?.sectionId).toBe("s1");
  });

  it("parses review JSON when response contains extra braces", () => {
    const raw = `说明：请关注 {"hint":"ignore"} 后的主体。
{
  "round": 2,
  "overallScore": 7,
  "sectionFeedback": [],
  "coherenceIssues": ["过渡略生硬"],
  "globalSuggestions": ["增强结尾总结"]
}`;
    const parsed = parseReviewFeedback(raw, 2);
    expect(parsed.round).toBe(2);
    expect(parsed.overallScore).toBe(7);
    expect(parsed.coherenceIssues).toContain("过渡略生硬");
  });

  it("rejects review payloads with mismatched rounds", () => {
    const raw = JSON.stringify({
      round: 1,
      overallScore: 8,
      sectionFeedback: [],
      coherenceIssues: [],
      globalSuggestions: [],
    });

    expect(() => parseReviewFeedback(raw, 2)).toThrow("审阅轮次不匹配");
  });
});
