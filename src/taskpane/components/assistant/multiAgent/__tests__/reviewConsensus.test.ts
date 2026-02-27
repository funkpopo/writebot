import { describe, expect, it } from "bun:test";
import { __reviewConsensusInternals } from "../reviewConsensus";
import type { ArticleOutline, ReviewFeedback } from "../types";

const outline: ArticleOutline = {
  title: "测试",
  theme: "主题",
  targetAudience: "读者",
  style: "专业",
  sections: [
    {
      id: "s1",
      title: "章节一",
      level: 1,
      description: "",
      keyPoints: [],
      estimatedParagraphs: 2,
    },
    {
      id: "s2",
      title: "章节二",
      level: 1,
      description: "",
      keyPoints: [],
      estimatedParagraphs: 2,
    },
  ],
  totalEstimatedParagraphs: 4,
};

const primary: ReviewFeedback = {
  round: 1,
  overallScore: 8,
  sectionFeedback: [
    { sectionId: "s1", issues: [], suggestions: [], needsRevision: false },
    { sectionId: "s2", issues: ["问题 A"], suggestions: [], needsRevision: true },
  ],
  coherenceIssues: [],
  globalSuggestions: [],
};

const critic: ReviewFeedback = {
  round: 1,
  overallScore: 6,
  sectionFeedback: [
    { sectionId: "s1", issues: ["问题 B"], suggestions: [], needsRevision: true },
    { sectionId: "s2", issues: [], suggestions: ["建议 C"], needsRevision: true },
  ],
  coherenceIssues: ["连贯性问题"],
  globalSuggestions: ["全局建议"],
};

describe("reviewConsensus internals", () => {
  it("calculates conflict count by needsRevision disagreement", () => {
    const conflicts = __reviewConsensusInternals.calculateConflictCount(outline, primary, critic);
    expect(conflicts).toBe(1);
  });

  it("fallback merge combines issues and keeps round", () => {
    const merged = __reviewConsensusInternals.fallbackMergeFeedback(outline, 2, primary, critic);
    expect(merged.round).toBe(2);
    expect(merged.sectionFeedback.find((item) => item.sectionId === "s1")?.needsRevision).toBe(true);
    expect(merged.coherenceIssues).toContain("连贯性问题");
    expect(merged.globalSuggestions).toContain("全局建议");
  });
});
