import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { parseReviewFeedback } from "./outlineParser";
import { REVIEWER_SYSTEM_PROMPT } from "./prompts";
import { reviewDocument } from "./reviewerAgent";
import type { ArticleOutline, ReviewFeedback, SectionFeedback } from "./types";

const CRITIC_SYSTEM_PROMPT = `${REVIEWER_SYSTEM_PROMPT}

附加职责（Critic 视角）：
1. 你需要主动发现隐藏风险，不要只做表面检查。
2. 对事实跳跃、逻辑断裂、术语不一致、观点冲突保持更高敏感度。
3. 对真正影响可读性和可信度的问题，可将 needsRevision 设为 true。
4. 仍需避免吹毛求疵，保证反馈可执行。`;

const ARBITER_SYSTEM_PROMPT = `你是 WriteBot 的审阅仲裁者（Arbiter）。

输入会包含：
- 文章大纲
- 文档全文
- Reviewer A 的 JSON 反馈
- Reviewer B（Critic）的 JSON 反馈

你的任务：
1. 比较两份反馈，合并有效信息，去除重复和噪音。
2. 当两者冲突时，优先保留证据更充分、可执行性更高的意见。
3. 对每个章节给出最终 needsRevision 判定。
4. 输出必须是有效 JSON，结构与 ReviewFeedback 完全一致：
{
  "round": 1,
  "overallScore": 8,
  "sectionFeedback": [
    {
      "sectionId": "s1",
      "issues": ["问题描述"],
      "suggestions": ["修改建议"],
      "needsRevision": false
    }
  ],
  "coherenceIssues": ["段落间/章节间的连贯性问题"],
  "globalSuggestions": ["全局改进建议"]
}

禁止输出任何解释文本，只输出 JSON。`;

export interface ConsensusReviewResult {
  primaryFeedback: ReviewFeedback;
  criticFeedback: ReviewFeedback;
  finalFeedback: ReviewFeedback;
  conflictCount: number;
  agreementRate: number;
}

function uniqueStrings(input: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of input) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function mergeSectionFeedback(
  sectionId: string,
  primary?: SectionFeedback,
  critic?: SectionFeedback,
): SectionFeedback {
  return {
    sectionId,
    issues: uniqueStrings([...(primary?.issues || []), ...(critic?.issues || [])]),
    suggestions: uniqueStrings([...(primary?.suggestions || []), ...(critic?.suggestions || [])]),
    needsRevision: Boolean(primary?.needsRevision || critic?.needsRevision),
  };
}

function fallbackMergeFeedback(
  outline: ArticleOutline,
  round: number,
  primary: ReviewFeedback,
  critic: ReviewFeedback,
): ReviewFeedback {
  const allSectionIds = outline.sections.map((section) => section.id);
  const sectionFeedback = allSectionIds.map((sectionId) =>
    mergeSectionFeedback(
      sectionId,
      primary.sectionFeedback.find((item) => item.sectionId === sectionId),
      critic.sectionFeedback.find((item) => item.sectionId === sectionId),
    )
  );

  return {
    round,
    overallScore: Math.min(
      10,
      Math.max(
        1,
        Math.round((primary.overallScore + critic.overallScore) / 2),
      ),
    ),
    sectionFeedback,
    coherenceIssues: uniqueStrings([
      ...primary.coherenceIssues,
      ...critic.coherenceIssues,
    ]),
    globalSuggestions: uniqueStrings([
      ...primary.globalSuggestions,
      ...critic.globalSuggestions,
    ]),
  };
}

function calculateConflictCount(
  outline: ArticleOutline,
  primary: ReviewFeedback,
  critic: ReviewFeedback,
): number {
  let conflicts = 0;
  for (const section of outline.sections) {
    const a = primary.sectionFeedback.find((item) => item.sectionId === section.id);
    const b = critic.sectionFeedback.find((item) => item.sectionId === section.id);
    if (Boolean(a?.needsRevision) !== Boolean(b?.needsRevision)) {
      conflicts += 1;
    }
  }
  return conflicts;
}

function buildArbiterContext(params: {
  outline: ArticleOutline;
  documentText: string;
  round: number;
  primaryFeedback: ReviewFeedback;
  criticFeedback: ReviewFeedback;
  focusSectionId?: string;
}): string {
  const {
    outline,
    documentText,
    round,
    primaryFeedback,
    criticFeedback,
    focusSectionId,
  } = params;

  const parts: string[] = [];
  parts.push("## 审阅轮次");
  parts.push(String(round));
  if (focusSectionId) {
    parts.push(`聚焦章节：${focusSectionId}`);
  }
  parts.push("");
  parts.push("## 文章大纲");
  parts.push(JSON.stringify(outline, null, 2));
  parts.push("");
  parts.push("## 文档全文");
  parts.push(documentText || "（空文档）");
  parts.push("");
  parts.push("## Reviewer A 反馈");
  parts.push(JSON.stringify(primaryFeedback, null, 2));
  parts.push("");
  parts.push("## Reviewer B / Critic 反馈");
  parts.push(JSON.stringify(criticFeedback, null, 2));
  return parts.join("\n");
}

function withTemperature(
  options: AIRequestOptions | undefined,
  fallback: number,
): AIRequestOptions | undefined {
  const base = { ...(options || {}) };
  if (typeof base.temperature !== "number") {
    base.temperature = fallback;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

export async function runConsensusReview(params: {
  outline: ArticleOutline;
  documentText: string;
  round: number;
  previousFeedback?: ReviewFeedback;
  focusSectionId?: string;
  reviewerOptions?: AIRequestOptions;
  criticOptions?: AIRequestOptions;
  arbiterOptions?: AIRequestOptions;
}): Promise<ConsensusReviewResult> {
  const {
    outline,
    documentText,
    round,
    previousFeedback,
    focusSectionId,
    reviewerOptions,
    criticOptions,
    arbiterOptions,
  } = params;

  const primaryFeedback = await reviewDocument({
    outline,
    documentText,
    round,
    previousFeedback,
    focusSectionId,
    reviewerLens: "平衡审阅：兼顾内容完整性与可读性。",
    aiOptions: reviewerOptions,
  });

  const criticFeedback = await reviewDocument({
    outline,
    documentText,
    round,
    previousFeedback,
    focusSectionId,
    reviewerLens: "严格质检：重点识别逻辑漏洞、事实跳跃与术语不一致。",
    systemPromptOverride: CRITIC_SYSTEM_PROMPT,
    aiOptions: withTemperature(criticOptions || reviewerOptions, 0.3),
  });

  const conflictCount = calculateConflictCount(outline, primaryFeedback, criticFeedback);
  const sectionCount = Math.max(1, outline.sections.length);
  const agreementRate = 1 - conflictCount / sectionCount;

  const arbiterPrompt = buildArbiterContext({
    outline,
    documentText,
    round,
    primaryFeedback,
    criticFeedback,
    focusSectionId,
  });

  let finalFeedback: ReviewFeedback;
  try {
    const arbiterResult = await callAI(
      arbiterPrompt,
      ARBITER_SYSTEM_PROMPT,
      withTemperature(arbiterOptions || reviewerOptions, 0),
    );
    finalFeedback = parseReviewFeedback(
      (arbiterResult.rawMarkdown ?? arbiterResult.content).trim(),
      round,
    );
  } catch {
    finalFeedback = fallbackMergeFeedback(
      outline,
      round,
      primaryFeedback,
      criticFeedback,
    );
  }

  return {
    primaryFeedback,
    criticFeedback,
    finalFeedback,
    conflictCount,
    agreementRate,
  };
}

export const __reviewConsensusInternals = {
  fallbackMergeFeedback,
  calculateConflictCount,
};
