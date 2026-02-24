import { callAI } from "../../../../utils/aiService";
import { REVIEWER_SYSTEM_PROMPT } from "./prompts";
import { parseReviewFeedback } from "./outlineParser";
import { buildReviewContext } from "./contextBuilder";
import type { ArticleOutline, ReviewFeedback } from "./types";

/**
 * Reviewer Agent: reviews the full document against the outline.
 * Uses callAI() (no tools, no streaming) since it only produces JSON feedback.
 */
export async function reviewDocument(params: {
  outline: ArticleOutline;
  documentText: string;
  round: number;
  previousFeedback?: ReviewFeedback;
}): Promise<ReviewFeedback> {
  const { outline, documentText, round, previousFeedback } = params;

  const previousFeedbackJson = previousFeedback
    ? JSON.stringify(previousFeedback, null, 2)
    : undefined;

  const userMessage = buildReviewContext(outline, documentText, round, previousFeedbackJson);
  const result = await callAI(userMessage, REVIEWER_SYSTEM_PROMPT);
  const rawContent = (result.rawMarkdown ?? result.content).trim();
  return parseReviewFeedback(rawContent, round);
}
