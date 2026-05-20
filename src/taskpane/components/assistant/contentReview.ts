import { callAI } from "../../../utils/aiService";
import { getPrompt } from "../../../utils/promptService";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";

export interface ContentReviewResult {
  text: string;
  changed: boolean;
  blocked: boolean;
  messages: string[];
}

interface ReviewDependencies {
  callReviewAI?: typeof callAI;
  getReviewPrompt?: typeof getPrompt;
}

function buildReviewPrompt(text: string, userInput: string): string {
  return [
    "用户原始需求：",
    "<<<<USER_REQUEST",
    userInput,
    "USER_REQUEST>>>>",
    "",
    "待写入草稿：",
    "<<<<DRAFT",
    text,
    "DRAFT>>>>",
  ].join("\n");
}

export async function reviewAssistantWriteContent(
  text: string,
  userInput: string,
  dependencies: ReviewDependencies = {}
): Promise<ContentReviewResult> {
  const callReviewAI = dependencies.callReviewAI || callAI;
  const getReviewPrompt = dependencies.getReviewPrompt || getPrompt;
  const response = await callReviewAI(
    buildReviewPrompt(text, userInput),
    getReviewPrompt("write_content_reviewer")
  );
  const reviewedText = sanitizeMarkdownToPlainText(response.rawMarkdown ?? response.content).trim();

  if (!reviewedText) {
    return {
      text,
      changed: false,
      blocked: true,
      messages: ["模型审查未返回可写入内容"],
    };
  }

  return {
    text: reviewedText,
    changed: reviewedText !== text.trim(),
    blocked: false,
    messages: ["已完成写入前内容审查"],
  };
}
