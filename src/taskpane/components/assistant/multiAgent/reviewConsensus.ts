import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { getPrompt } from "../../../../utils/promptService";
import type { AgentHarnessRuntime } from "./agentHarness";
import { countReviewBundleChars, filterReviewContextBundle } from "./contextBuilder";
import type { ReviewContextBundle } from "./documentSession";
import { parseReviewFeedback } from "./outlineParser";
import { reviewDocument } from "./reviewerAgent";
import type { ArticleOutline, ReviewFeedback, SectionFeedback } from "./types";

const ARBITER_SYSTEM_PROMPT = `你是 WriteBot 的审阅仲裁者（Arbiter）。

输入会包含：
- 文章大纲
- ReviewContextBundle 中的章节级正文、索引锚点和局部预览
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

function mergeAgreedFeedback(
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
  return calculateConflictSectionIds(outline, primary, critic).length;
}

function calculateConflictSectionIds(
  outline: ArticleOutline,
  primary: ReviewFeedback,
  critic: ReviewFeedback,
): string[] {
  const conflictSectionIds: string[] = [];
  for (const section of outline.sections) {
    const a = primary.sectionFeedback.find((item) => item.sectionId === section.id);
    const b = critic.sectionFeedback.find((item) => item.sectionId === section.id);
    if (Boolean(a?.needsRevision) !== Boolean(b?.needsRevision)) {
      conflictSectionIds.push(section.id);
    }
  }
  return conflictSectionIds;
}

function renderArbiterReviewBundle(bundle: ReviewContextBundle): string {
  return JSON.stringify({
    outlineSummary: bundle.outlineSummary,
    promptContract: bundle.promptContract,
    changedSectionIds: bundle.changedSectionIds,
    indexSummary: {
      sessionId: bundle.indexSummary.sessionId,
      indexVersion: bundle.indexSummary.indexVersion,
      paragraphCount: bundle.indexSummary.paragraphCount,
      headingCount: bundle.indexSummary.headingCount,
    },
    sectionBundles: bundle.sectionBundles.map((section) => ({
      sectionId: section.sectionId,
      sectionTitle: section.sectionTitle,
      outlineDescription: section.outlineDescription,
      keyPoints: section.keyPoints,
      range: section.range,
      headingAnchor: section.headingAnchor,
      beforePreview: section.beforePreview,
      afterPreview: section.afterPreview,
      sourceAnchors: section.sourceAnchors,
      content: section.content,
    })),
  }, null, 2);
}

function buildArbiterContext(params: {
  outline: ArticleOutline;
  reviewBundle: ReviewContextBundle;
  round: number;
  primaryFeedback: ReviewFeedback;
  criticFeedback: ReviewFeedback;
  focusSectionId?: string;
}): string {
  const {
    outline,
    reviewBundle,
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
  parts.push("## 冲突章节 ReviewContextBundle");
  parts.push(renderArbiterReviewBundle(reviewBundle));
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
  defaultTemperature: number,
): AIRequestOptions | undefined {
  const base = { ...(options || {}) };
  if (typeof base.temperature !== "number") {
    base.temperature = defaultTemperature;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

function buildCriticSystemPrompt(): string {
  return `${getPrompt("agent_reviewer")}

附加职责（Critic 视角）：
1. 你需要主动发现隐藏风险，不要只做表面检查。
2. 对事实跳跃、逻辑断裂、术语不一致、观点冲突保持更高敏感度。
3. 对真正影响可读性和可信度的问题，可将 needsRevision 设为 true。
4. 仍需避免吹毛求疵，保证反馈可执行。`;
}

export async function runConsensusReview(params: {
  outline: ArticleOutline;
  reviewBundle: ReviewContextBundle;
  round: number;
  previousFeedback?: ReviewFeedback;
  focusSectionId?: string;
  harness: AgentHarnessRuntime;
  reviewerOptions?: AIRequestOptions;
  criticOptions?: AIRequestOptions;
  arbiterOptions?: AIRequestOptions;
}): Promise<ConsensusReviewResult> {
  const {
    outline,
    reviewBundle,
    round,
    previousFeedback,
    focusSectionId,
    harness,
    reviewerOptions,
    criticOptions,
    arbiterOptions,
  } = params;

  const [primaryFeedback, criticFeedback] = await Promise.all([
    reviewDocument({
      agentId: "reviewer",
      outline,
      reviewBundle,
      round,
      previousFeedback,
      focusSectionId,
      reviewerLens: "平衡审阅：兼顾内容完整性与可读性。",
      harness,
      aiOptions: reviewerOptions,
    }),
    reviewDocument({
      agentId: "critic",
      outline,
      reviewBundle,
      round,
      previousFeedback,
      focusSectionId,
      reviewerLens: "严格质检：重点识别逻辑漏洞、事实跳跃与术语不一致。",
      systemPromptOverride: buildCriticSystemPrompt(),
      harness,
      aiOptions: withTemperature(criticOptions || reviewerOptions, 0.3),
    }),
  ]);

  const conflictSectionIds = calculateConflictSectionIds(outline, primaryFeedback, criticFeedback);
  const conflictCount = conflictSectionIds.length;
  const sectionCount = Math.max(1, outline.sections.length);
  const agreementRate = 1 - conflictCount / sectionCount;

  let finalFeedback: ReviewFeedback;
  if (conflictCount === 0) {
    // Reviewer 与 Critic 在各章 needsRevision 上完全一致：执行确定性合并，不调用第三路模型。
    finalFeedback = mergeAgreedFeedback(
      outline,
      round,
      primaryFeedback,
      criticFeedback,
    );
  } else {
    const arbiterSectionIds = focusSectionId
      ? [focusSectionId]
      : conflictSectionIds;
    const arbiterBundle = filterReviewContextBundle(reviewBundle, arbiterSectionIds);
    const arbiterPrompt = buildArbiterContext({
      outline,
      reviewBundle: arbiterBundle,
      round,
      primaryFeedback,
      criticFeedback,
      focusSectionId,
    });

    finalFeedback = await harness.withAgentStep(
      "arbiter",
      "arbiter.resolve_review_conflict",
      () => harness.runModelStep({
        agentId: "arbiter",
        stepName: "arbiter.resolve_review_conflict",
        callModel: async () => {
          const arbiterResult = await callAI(
            arbiterPrompt,
            ARBITER_SYSTEM_PROMPT,
            withTemperature(arbiterOptions || reviewerOptions, 0),
          );
          return (arbiterResult.rawMarkdown ?? arbiterResult.content).trim();
        },
        parse: (rawContent) => parseReviewFeedback(rawContent, round),
        metadata: {
          round,
          conflictCount,
          conflictSectionIds,
          focusSectionId,
          sectionBundleCount: arbiterBundle.sectionBundles.length,
          reviewBundleChars: countReviewBundleChars(arbiterBundle),
        },
      }),
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
  mergeAgreedFeedback,
  calculateConflictCount,
  calculateConflictSectionIds,
  buildArbiterContext,
};
