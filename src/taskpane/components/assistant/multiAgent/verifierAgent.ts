import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { parseVerificationFeedback } from "./outlineParser";
import { VERIFIER_SYSTEM_PROMPT } from "./prompts";
import type { OutlineSection, VerificationFeedback } from "./types";

function buildVerifierContext(params: {
  section: OutlineSection;
  sectionText: string;
  declarationPoints?: string[];
}): string {
  const { section, sectionText, declarationPoints = [] } = params;
  const points = declarationPoints.filter((item) => item.trim().length > 0);
  const keyPoints = section.keyPoints.filter((item) => item.trim().length > 0);
  const combinedPoints = [...keyPoints, ...points].filter((item, index, arr) => arr.indexOf(item) === index);

  const parts: string[] = [
    "## 章节信息",
    `sectionId: ${section.id}`,
    `title: ${section.title}`,
    `description: ${section.description || "（无）"}`,
    "",
    "## 章节正文",
    sectionText.trim() || "（空章节）",
    "",
    "## 关键声明点",
  ];

  if (combinedPoints.length === 0) {
    parts.push("（未提供明确声明点，请你从章节正文提取关键结论进行核验）");
  } else {
    for (const point of combinedPoints) {
      parts.push(`- ${point}`);
    }
  }

  parts.push("");
  parts.push("请基于章节正文做核验，不要编造外部来源。anchor 优先用段落索引形式（如 p1、p2）。");
  return parts.join("\n");
}

export async function verifySectionFacts(params: {
  section: OutlineSection;
  sectionText: string;
  declarationPoints?: string[];
  aiOptions?: AIRequestOptions;
}): Promise<VerificationFeedback> {
  const {
    section,
    sectionText,
    declarationPoints,
    aiOptions,
  } = params;

  const userMessage = buildVerifierContext({
    section,
    sectionText,
    declarationPoints,
  });
  const result = await callAI(
    userMessage,
    VERIFIER_SYSTEM_PROMPT,
    aiOptions,
  );
  return parseVerificationFeedback((result.rawMarkdown ?? result.content).trim());
}
