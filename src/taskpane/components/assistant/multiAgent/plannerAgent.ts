import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { PLANNER_SYSTEM_PROMPT } from "./prompts";
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

  const result = await callAI(userMessage, PLANNER_SYSTEM_PROMPT, aiOptions);
  const rawContent = (result.rawMarkdown ?? result.content).trim();
  return parseOutlineFromResponse(rawContent);
}
