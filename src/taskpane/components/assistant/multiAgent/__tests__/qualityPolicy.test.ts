import { describe, expect, it } from "bun:test";
import {
  AUTO_REVISION_SCORE_THRESHOLD,
  isReviewScoreAcceptable,
  shouldAutoReviseReviewFeedback,
} from "../qualityPolicy";
import type { ReviewFeedback } from "../types";

function reviewFeedback(overallScore: number): ReviewFeedback {
  return {
    round: 1,
    overallScore,
    sectionFeedback: [],
    coherenceIssues: [],
    globalSuggestions: [],
  };
}

describe("qualityPolicy", () => {
  it("uses 4/10 as the automatic revision boundary", () => {
    expect(AUTO_REVISION_SCORE_THRESHOLD).toBe(4);
    expect(isReviewScoreAcceptable(4)).toBe(true);
    expect(isReviewScoreAcceptable(3)).toBe(false);
    expect(shouldAutoReviseReviewFeedback(reviewFeedback(4))).toBe(false);
    expect(shouldAutoReviseReviewFeedback(reviewFeedback(3))).toBe(true);
  });
});
