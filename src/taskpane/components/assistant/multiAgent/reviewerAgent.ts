import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
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
  aiOptions?: AIRequestOptions;
}): Promise<ReviewFeedback> {
  const {
    outline,
    documentText,
    round,
    previousFeedback,
    focusSectionId,
    aiOptions,
  } = params;

  const previousFeedbackJson = previousFeedback
    ? JSON.stringify(previousFeedback, null, 2)
    : undefined;

  const userMessage = buildReviewContext(outline, documentText, round, previousFeedbackJson, focusSectionId);
  const result = await callAI(userMessage, REVIEWER_SYSTEM_PROMPT, aiOptions);
  const rawContent = (result.rawMarkdown ?? result.content).trim();
  return parseReviewFeedback(rawContent, round);
}
