import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime } from "./agentHarness";
import { parseOutlineFromResponse } from "./outlineParser";
import type { ArticleOutline } from "./types";

/**
 * Planner Agent: generates a structured article outline from user requirements.
 * Uses callAI() (no tools, no streaming) since it only produces JSON.
 */
export async function generateOutline(
  userRequirement: string,
  documentContext: string,
  harness: AgentHarnessRuntime,
  aiOptions?: AIRequestOptions,
): Promise<ArticleOutline> {
  const userMessage = [
    "## 用户需求",
    userRequirement,
    "",
    documentContext.trim()
      ? `## 当前文档内容\n${documentContext}`
      : "## 当前文档内容\n（空文档）",
  ].join("\n");

  return harness.withAgentStep(
    "planner",
    "generate_outline",
    () => harness.runModelStep({
      agentId: "planner",
      stepName: "planner.generate_outline",
      callModel: async () => {
        const result = await callAI(userMessage, getPrompt("agent_planner_v2"), aiOptions);
        return (result.rawMarkdown ?? result.content).trim();
      },
      parse: parseOutlineFromResponse,
      metadata: {
        documentContextChars: documentContext.length,
        userRequirementChars: userRequirement.length,
      },
    }),
  );
}
