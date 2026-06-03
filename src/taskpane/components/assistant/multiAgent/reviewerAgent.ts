import { callAIStream, type AIRequestOptions, type StreamCallback } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime, AgentId } from "./agentHarness";
import { parseReviewFeedback } from "./outlineParser";
import { buildReviewContext, countReviewBundleChars } from "./contextBuilder";
import type { ReviewContextBundle } from "./documentSession";
import type { ArticleOutline, ReviewFeedback } from "./types";

/**
 * Reviewer Agent: reviews the document against the outline.
 * When focusSectionId is provided, focuses on that specific section.
 * Uses the streaming model transport and aggregates the final JSON feedback for parsing.
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
  onChunk?: StreamCallback;
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
    onChunk,
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
        const result = await callAIStream(
          userMessage,
          systemPromptOverride || getPrompt("agent_reviewer"),
          onChunk,
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
