import { callAI } from "../../../../utils/aiService";
import { REVIEWER_SYSTEM_PROMPT } from "./prompts";
import { parseReviewFeedback } from "./outlineParser";
import { buildReviewContext } from "./contextBuilder";
import type { ArticleOutline, ReviewFeedback } from "./types";

/**
 * Reviewer Agent: reviews the document against the outline.
 * When focusSectionId is provided, focuses on that specific section.
 * Uses callAI() (no tools, no streaming) since it only produces JSON feedback.
 */
export async function reviewDocument(params: {
  outline: ArticleOutline;
  documentText: string;
  round: number;
  previousFeedback?: ReviewFeedback;
  focusSectionId?: string;
}): Promise<ReviewFeedback> {
  const { outline, documentText, round, previousFeedback, focusSectionId } = params;

  const previousFeedbackJson = previousFeedback
    ? JSON.stringify(previousFeedback, null, 2)
    : undefined;

  const userMessage = buildReviewContext(outline, documentText, round, previousFeedbackJson, focusSectionId);
  const result = await callAI(userMessage, REVIEWER_SYSTEM_PROMPT);
  const rawContent = (result.rawMarkdown ?? result.content).trim();
  return parseReviewFeedback(rawContent, round);
}
