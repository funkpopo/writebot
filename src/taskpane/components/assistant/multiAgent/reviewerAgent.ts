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
  reviewerLens?: string;
  systemPromptOverride?: string;
  aiOptions?: AIRequestOptions;
}): Promise<ReviewFeedback> {
  const {
    outline,
    documentText,
    round,
    previousFeedback,
    focusSectionId,
    reviewerLens,
    systemPromptOverride,
    aiOptions,
  } = params;

  const previousFeedbackJson = previousFeedback
    ? JSON.stringify(previousFeedback, null, 2)
    : undefined;

  const userMessage = buildReviewContext(
    outline,
    documentText,
    round,
    previousFeedbackJson,
    focusSectionId,
    reviewerLens,
  );
  const result = await callAI(
    userMessage,
    systemPromptOverride || REVIEWER_SYSTEM_PROMPT,
    aiOptions,
  );
  const rawContent = (result.rawMarkdown ?? result.content).trim();
  try {
    return parseReviewFeedback(rawContent, round);
  } catch (error) {
    console.warn("Reviewer JSON 解析失败，使用降级反馈继续流程:", error);
    return {
      round,
      overallScore: 6,
      sectionFeedback: outline.sections.map((section) => ({
        sectionId: section.id,
        issues: [],
        suggestions: [],
        needsRevision: false,
      })),
      coherenceIssues: [],
      globalSuggestions: [
        "Reviewer 返回非标准 JSON，已跳过本轮结构化审阅；建议后续人工快速复核整体连贯性。",
      ],
    };
  }
}
