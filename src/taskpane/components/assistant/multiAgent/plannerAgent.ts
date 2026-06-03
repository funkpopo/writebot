import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime } from "./agentHarness";
import { renderDocumentIndexSummary, type DocumentIndexSummary } from "./documentSession";
import { parseOutlineFromResponse } from "./outlineParser";
import {
  buildPromptContractUserMessage,
  type PromptIntakeContract,
} from "./promptIntake";
import type { ArticleOutline } from "./types";

export function attachPromptContractMetadata(
  outline: ArticleOutline,
  contract: PromptIntakeContract,
  contractHash: string,
): ArticleOutline {
  return {
    ...outline,
    promptContractHash: contractHash,
    taskType: contract.taskType,
    primaryGoal: contract.primaryGoal,
    hardConstraints: [...contract.hardConstraints],
    outputRequirements: { ...contract.outputRequirements },
    documentDependency: contract.documentDependency,
  };
}

/**
 * Planner Agent: generates a structured article outline from user requirements.
 * Uses callAI() (no tools, no streaming) since it only produces JSON.
 */
export async function generateOutline(
  promptContract: PromptIntakeContract,
  promptContractHash: string,
  documentIndexSummary: DocumentIndexSummary,
  harness: AgentHarnessRuntime,
  aiOptions?: AIRequestOptions,
): Promise<ArticleOutline> {
  const userMessage = [
    buildPromptContractUserMessage(promptContract),
    "",
    "## 当前文档索引摘要",
    renderDocumentIndexSummary(documentIndexSummary),
    "",
    "## Planner Contract Rules",
    "- 必须围绕 primaryGoal 生成大纲。",
    "- 必须逐条遵守 hardConstraints；如 hardConstraints 与默认文章模板冲突，以 hardConstraints 为准。",
    "- 不得使用默认文章模板覆盖、弱化或改写 Prompt Intake Contract 中的约束。",
    "- 若用户要求修改现有文档，不得把任务改写为新文章生成。",
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
      parse: (rawContent) => {
        const outline = parseOutlineFromResponse(rawContent);
        return attachPromptContractMetadata(outline, promptContract, promptContractHash);
      },
      metadata: {
        promptContractHash,
        taskType: promptContract.taskType,
        primaryGoal: promptContract.primaryGoal,
        hardConstraints: promptContract.hardConstraints,
        documentDependency: promptContract.documentDependency,
        documentSessionId: documentIndexSummary.sessionId,
        documentIndexVersion: documentIndexSummary.indexVersion,
        documentParagraphCount: documentIndexSummary.paragraphCount,
        userRequirementChars: promptContract.rawPrompt.length,
      },
    }),
  );
}
