import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime } from "./agentHarness";
import { parseOutlineFromResponse } from "./outlineParser";
import {
  buildPromptContractUserMessage,
  type PromptIntakeContract,
} from "./promptIntake";
import type { ArticleOutline } from "./types";

function contractRequiresNoIntroduction(contract: PromptIntakeContract): boolean {
  const haystack = [
    ...contract.hardConstraints,
    contract.outputRequirements.structure || "",
    contract.rawPrompt,
  ].join("\n");
  return /(不要|不写|无|禁止).{0,8}(引言|导言|序言|开头)|\b(no|without)\s+introduction\b/i.test(haystack);
}

export function assertOutlineHonorsPromptContract(
  outline: ArticleOutline,
  contract: PromptIntakeContract,
): void {
  if (contractRequiresNoIntroduction(contract)) {
    const introSection = outline.sections.find((section) =>
      /(引言|导言|序言|introduction|intro)/i.test(section.title)
    );
    if (introSection) {
      throw new Error(`Planner 违反用户硬约束：要求不要写引言，但输出了章节 "${introSection.title}"`);
    }
  }
}

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
  documentContext: string,
  harness: AgentHarnessRuntime,
  aiOptions?: AIRequestOptions,
): Promise<ArticleOutline> {
  const userMessage = [
    buildPromptContractUserMessage(promptContract),
    "",
    documentContext.trim()
      ? `## 当前文档内容\n${documentContext}`
      : "## 当前文档内容\n（空文档）",
    "",
    "## Planner Contract Rules",
    "- 必须围绕 primaryGoal 生成大纲。",
    "- 必须逐条遵守 hardConstraints；如 hardConstraints 与默认文章模板冲突，以 hardConstraints 为准。",
    "- 若用户要求不要写引言，不得输出“引言 / 导言 / Introduction”等章节，也不得把首章写成引言。",
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
        assertOutlineHonorsPromptContract(outline, promptContract);
        return attachPromptContractMetadata(outline, promptContract, promptContractHash);
      },
      metadata: {
        promptContractHash,
        taskType: promptContract.taskType,
        primaryGoal: promptContract.primaryGoal,
        hardConstraints: promptContract.hardConstraints,
        documentDependency: promptContract.documentDependency,
        documentContextChars: documentContext.length,
        userRequirementChars: promptContract.rawPrompt.length,
      },
    }),
  );
}
