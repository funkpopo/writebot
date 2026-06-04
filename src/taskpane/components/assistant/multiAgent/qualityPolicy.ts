import type { ReviewFeedback } from "./types";

export const AUTO_REVISION_SCORE_THRESHOLD = 4;

export function isReviewScoreAcceptable(overallScore: number): boolean {
  return overallScore >= AUTO_REVISION_SCORE_THRESHOLD;
}

export function shouldAutoReviseReviewFeedback(feedback: ReviewFeedback): boolean {
  return !isReviewScoreAcceptable(feedback.overallScore);
}
