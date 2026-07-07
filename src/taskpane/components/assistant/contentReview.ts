import { callAI } from "../../../utils/aiService";
import { getPrompt } from "../../../utils/promptService";
import { stripEmojis } from "../../../utils/textSanitizer";

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

  let response: Awaited<ReturnType<typeof callAI>>;
  try {
    response = await callReviewAI(
      buildReviewPrompt(text, userInput),
      getReviewPrompt("write_content_reviewer")
    );
  } catch (error) {
    // 审查是辅助质量步骤：模型/网络故障时放行原文，不应让整次写入失败。
    return {
      text,
      changed: false,
      blocked: false,
      messages: [
        `写入前内容审查不可用（${error instanceof Error ? error.message : String(error)}），已按原文写入`,
      ],
    };
  }

  // 审查员被要求返回“最终可写入版本”。草稿可能是 Markdown（标题/列表/表格），
  // 这里只清理 emoji，绝不能做 Markdown → 纯文本的破坏性转换，
  // 否则后续按 markdown contentFormat 渲染时结构全部丢失。
  const reviewedText = stripEmojis(response.rawMarkdown ?? response.content).trim();

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
