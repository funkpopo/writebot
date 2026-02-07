export type StyleType = "formal" | "casual" | "professional" | "creative";
export type ActionType =
  | "agent"
  | "polish"
  | "translate"
  | "grammar"
  | "summarize"
  | "continue"
  | "generate"
  | null;

export interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  plainText?: string;
  applyContent?: string;
  thinking?: string;
  action?: ActionType;
  uiOnly?: boolean;
  timestamp: Date;
}

export const styleLabels: Record<StyleType, string> = {
  formal: "正式",
  casual: "轻松",
  professional: "专业",
  creative: "创意",
};

export const MAX_TOOL_LOOPS = 6;

export const STATUS_TAG = "[[STATUS]]";
export const CONTENT_TAG = "[[CONTENT]]";

export function formatOriginalTextForBubble(input: string): string {
  const raw = typeof input === "string" ? input : String(input ?? "");

  // Normalize various line separators to LF so `white-space: pre-wrap` renders them consistently.
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Unicode line/paragraph separators (sometimes appear when copying content).
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n")
    // Vertical tab / form feed.
    .replace(/\v/g, "\n")
    .replace(/\f/g, "\n");

  const lines = normalized
    .split("\n")
    // Avoid trailing whitespace creating odd copy/paste artifacts.
    .map((line) => line.replace(/[ \t]+$/g, ""));

  // Remove blank lines for user-visible "原文".
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  return nonEmptyLines.join("\n");
}

export function parseTaggedAgentContent(
  rawContent: string
): { statusText: string; contentText: string; hasTaggedOutput: boolean } {
  const source = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
  const statusIndex = source.indexOf(STATUS_TAG);
  const contentIndex = source.indexOf(CONTENT_TAG);

  if (statusIndex < 0 && contentIndex < 0) {
    return {
      statusText: "",
      contentText: source.trim(),
      hasTaggedOutput: false,
    };
  }

  const statusStart = statusIndex >= 0 ? statusIndex + STATUS_TAG.length : -1;
  const contentStart = contentIndex >= 0 ? contentIndex + CONTENT_TAG.length : -1;

  const statusText = statusStart >= 0
    ? source.slice(statusStart, contentIndex >= 0 ? contentIndex : source.length).trim()
    : "";

  const contentText = contentStart >= 0
    ? source.slice(contentStart).trim()
    : "";

  return {
    statusText,
    contentText,
    hasTaggedOutput: true,
  };
}

export function isStatusLikeContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.length > 140) return false;
  const statusKeywords = ["已完成", "完成", "失败", "已执行", "执行失败", "文档已更新", "已更新"];
  return statusKeywords.some((keyword) => trimmed.includes(keyword));
}

export function getActionLabel(action: ActionType): string {
  switch (action) {
    case "agent":
      return "智能需求";
    case "polish":
      return "润色";
    case "translate":
      return "翻译";
    case "grammar":
      return "语法检查";
    case "summarize":
      return "生成摘要";
    case "continue":
      return "续写内容";
    case "generate":
      return "生成内容";
    default:
      return "";
  }
}
