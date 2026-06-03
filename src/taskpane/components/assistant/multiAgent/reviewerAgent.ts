import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime, AgentId } from "./agentHarness";
import { parseReviewFeedback } from "./outlineParser";
import { buildReviewContext, countReviewBundleChars } from "./contextBuilder";
import type { ReviewContextBundle } from "./documentSession";
import type { ArticleOutline, ReviewFeedback } from "./types";

/**
 * Reviewer Agent: reviews the document against the outline.
 * When focusSectionId is provided, focuses on that specific section.
 * Uses callAI() (no tools, no streaming) since it only produces JSON feedback.
 */
export async function reviewDocument(params: {
  agentId: Extract<AgentId, "reviewer" | "critic">;
  outline: ArticleOutline;
  reviewBundle: ReviewContextBundle;
  round: number;
  previousFeedback?: ReviewFeedback;
  focusSectionId?: string;
  reviewerLens?: string;
  systemPromptOverride?: string;
  harness: AgentHarnessRuntime;
  aiOptions?: AIRequestOptions;
}): Promise<ReviewFeedback> {
  const {
    agentId,
    outline,
    reviewBundle,
    round,
    previousFeedback,
    focusSectionId,
    reviewerLens,
    systemPromptOverride,
    harness,
    aiOptions,
  } = params;

  const previousFeedbackJson = previousFeedback
    ? JSON.stringify(previousFeedback, null, 2)
    : undefined;

  const userMessage = buildReviewContext(
    reviewBundle,
    round,
    previousFeedbackJson,
    focusSectionId,
    reviewerLens,
  );
  return harness.withAgentStep(
    agentId,
    `${agentId}.review_document`,
    () => harness.runModelStep({
      agentId,
      stepName: `${agentId}.review_document`,
      callModel: async () => {
        const result = await callAI(
          userMessage,
          systemPromptOverride || getPrompt("agent_reviewer"),
          aiOptions,
        );
        return (result.rawMarkdown ?? result.content).trim();
      },
      parse: (rawContent) => parseReviewFeedback(rawContent, round),
      metadata: {
        round,
        focusSectionId,
        sectionBundleCount: reviewBundle.sectionBundles.length,
        reviewBundleChars: countReviewBundleChars(reviewBundle),
        outlineSectionCount: outline.sections.length,
      },
    }),
  );
}
