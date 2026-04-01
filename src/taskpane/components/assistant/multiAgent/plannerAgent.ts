import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import { parseOutlineFromResponse } from "./outlineParser";
import type { ArticleOutline } from "./types";

/**
 * Planner Agent: generates a structured article outline from user requirements.
 * Uses callAI() (no tools, no streaming) since it only produces JSON.
 */
export async function generateOutline(
  userRequirement: string,
  documentContext: string,
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

  const result = await callAI(userMessage, getPrompt("agent_planner_v2"), aiOptions);
  const rawContent = (result.rawMarkdown ?? result.content).trim();
  return parseOutlineFromResponse(rawContent);
}
