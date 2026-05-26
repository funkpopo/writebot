import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime, AgentId } from "./agentHarness";
import { parseReviewFeedback } from "./outlineParser";
import { buildReviewContext } from "./contextBuilder";
import type { ArticleOutline, ReviewFeedback } from "./types";

/**
 * Reviewer Agent: reviews the document against the outline.
 * When focusSectionId is provided, focuses on that specific section.
 * Uses callAI() (no tools, no streaming) since it only produces JSON feedback.
 */
export async function reviewDocument(params: {
  agentId: Extract<AgentId, "reviewer" | "critic">;
  outline: ArticleOutline;
  documentText: string;
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
    documentText,
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
    outline,
    documentText,
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
        documentChars: documentText.length,
      },
    }),
  );
}
