import type { ReviewContextBundle, ReviewSectionBundle } from "./documentSession";
import type { ArticleOutline, OutlineSection, SectionWriteResult } from "./types";

/**
 * Build the user message for the Writer agent when writing a section.
 * Provides full outline context + previously written content + current task.
 */
export function buildSectionContext(
  outline: ArticleOutline,
  currentSection: OutlineSection,
  previousSections: SectionWriteResult[],
  revisionFeedback?: string,
  memoryContext?: string,
): string {
  const parts: string[] = [];
  const currentIndex = outline.sections.findIndex((s) => s.id === currentSection.id);
  const nextSection = currentIndex >= 0 ? outline.sections[currentIndex + 1] : undefined;

  // 1. Full outline for global awareness
  parts.push("## 文章完整大纲");
  parts.push(`标题：${outline.title}`);
  parts.push(`主题：${outline.theme}`);
  parts.push(`目标读者：${outline.targetAudience}`);
  parts.push(`风格：${outline.style}`);
  parts.push("");
  parts.push("### 章节结构");
  for (const s of outline.sections) {
    const marker = s.id === currentSection.id ? " <-- 【当前章节】" : "";
    const indent = s.level > 1 ? "  " : "";
    parts.push(`${indent}${s.id}. ${s.title}${marker}`);
  }
  parts.push("");

  // 2. Previously written sections (recent ones in full, older ones summarized)
  if (previousSections.length > 0) {
    parts.push("## 已完成章节内容");
    for (let i = 0; i < previousSections.length; i++) {
      const prev = previousSections[i];
      const isRecent = i >= previousSections.length - 2;
      if (isRecent) {
        parts.push(`### ${prev.sectionTitle}`);
        parts.push(prev.content);
      } else {
        parts.push(`### ${prev.sectionTitle}（摘要）`);
        parts.push(prev.content.length > 300 ? prev.content.slice(0, 300) + "..." : prev.content);
      }
      parts.push("");
    }
  }

  // 3. Current section instructions
  parts.push("## 当前写作任务");
  parts.push(`请撰写章节：**${currentSection.title}**`);
  parts.push(`描述：${currentSection.description}`);
  if (currentSection.keyPoints.length > 0) {
    parts.push("需要覆盖的要点：");
    for (const kp of currentSection.keyPoints) {
      parts.push(`- ${kp}`);
    }
  }
  parts.push(`预估段落数：${currentSection.estimatedParagraphs}`);

  // 4. Revision feedback if applicable
  if (revisionFeedback) {
    parts.push("");
    parts.push("## 章节边界定位");
    parts.push(`当前章节标题锚点：${currentSection.title}`);
    if (nextSection) {
      parts.push(`下一章节标题锚点：${nextSection.title}`);
    }
    parts.push("先调用 get_document_index，定位当前章节标题对应的段落索引，再用 read_document_ranges 读取章节范围。");
    if (nextSection) {
      parts.push("若已存在下一章节标题，只能修改两者之间的段落范围。");
    } else {
      parts.push("若不存在下一章节标题，只能修改从当前章节标题到文末的内容。");
    }
    parts.push("");
    parts.push("## 修改要求（来自审阅反馈）");
    parts.push(revisionFeedback);
    parts.push("");
    parts.push("请用 rewrite_paragraph 或 replace_paragraph_range 精确修改命中的段落，避免重写整篇文档。");
  } else {
    parts.push("");
    parts.push("## 写入约束");
    if (currentIndex === 0) {
      parts.push(`若文档中尚无文章主标题，请先写 # ${outline.title}；然后写本章节标题 ## ${currentSection.title}。`);
    } else {
      parts.push(`请以章节标题 ## ${currentSection.title} 开头，标题文本必须与章节名完全一致。`);
    }
    parts.push("请先用 get_document_index 了解文档当前结构，必要时用 read_nearby_context 读取锚点附近上下文，然后使用 insert_at_anchor 在合适锚点后插入本章节内容。");
  }

  if (memoryContext?.trim()) {
    parts.push("## 长期记忆检索");
    parts.push(memoryContext.trim());
    parts.push("");
    parts.push("写作时优先保持与以上记忆的一致性（术语、角色设定、已写章节事实）。");
    parts.push("");
  }

  return parts.join("\n");
}

function renderSectionBundle(bundle: ReviewSectionBundle): string {
  const parts: string[] = [];
  parts.push(`### ${bundle.sectionTitle} (${bundle.sectionId})`);
  parts.push(`描述：${bundle.outlineDescription || "（无）"}`);
  if (bundle.keyPoints.length > 0) {
    parts.push("要点：");
    for (const keyPoint of bundle.keyPoints) {
      parts.push(`- ${keyPoint}`);
    }
  }
  if (bundle.range) {
    parts.push(
      `range: p${bundle.range.startParagraphIndex}-p${bundle.range.endParagraphIndex} / ${bundle.range.paragraphCount} 段`,
    );
  }
  if (bundle.headingAnchor) {
    parts.push(
      `headingAnchor: p${bundle.headingAnchor.paragraphIndex} / ${bundle.headingAnchor.paragraphTextHash}`,
    );
  }
  if (bundle.beforePreview) {
    parts.push(`beforePreview: ${bundle.beforePreview}`);
  }
  if (bundle.afterPreview) {
    parts.push(`afterPreview: ${bundle.afterPreview}`);
  }
  if (bundle.sourceAnchors.length > 0) {
    parts.push(`sourceAnchors: ${bundle.sourceAnchors.join(", ")}`);
  }
  parts.push("");
  parts.push(bundle.content.trim() || "（该章节缓存为空）");
  return parts.join("\n");
}

export function filterReviewContextBundle(
  bundle: ReviewContextBundle,
  sectionIds: string[],
): ReviewContextBundle {
  const idSet = new Set(sectionIds);
  return {
    ...bundle,
    sectionBundles: bundle.sectionBundles.filter((section) => idSet.has(section.sectionId)),
    changedSectionIds: bundle.changedSectionIds.filter((sectionId) => idSet.has(sectionId)),
    knownFacts: bundle.knownFacts.filter((fact) => {
      const section = bundle.sectionBundles.find((item) =>
        idSet.has(item.sectionId) && fact.startsWith(`${item.sectionTitle}:`)
      );
      return Boolean(section);
    }),
  };
}

export function countReviewBundleChars(bundle: ReviewContextBundle): number {
  return bundle.sectionBundles.reduce((sum, section) => sum + section.content.length, 0);
}

/**
 * Build the user message for the Reviewer agent from section-level bundles.
 * When focusSectionId is provided, the reviewer focuses on that section only.
 */
export function buildReviewContext(
  reviewBundle: ReviewContextBundle,
  round: number,
  previousFeedbackJson?: string,
  focusSectionId?: string,
  reviewerLens?: string,
): string {
  const parts: string[] = [];

  const focusedBundles = focusSectionId
    ? reviewBundle.sectionBundles.filter((section) => section.sectionId === focusSectionId)
    : reviewBundle.sectionBundles;

  parts.push("## ReviewContextBundle");
  parts.push(`标题：${reviewBundle.outlineSummary.title}`);
  parts.push(`主题：${reviewBundle.outlineSummary.theme}`);
  parts.push(`目标读者：${reviewBundle.outlineSummary.targetAudience}`);
  parts.push(`风格：${reviewBundle.outlineSummary.style}`);
  parts.push("");
  parts.push("## Prompt Contract");
  if (reviewBundle.promptContract.primaryGoal) {
    parts.push(`primaryGoal: ${reviewBundle.promptContract.primaryGoal}`);
  }
  if (reviewBundle.promptContract.hardConstraints.length > 0) {
    parts.push("hardConstraints:");
    for (const constraint of reviewBundle.promptContract.hardConstraints) {
      parts.push(`- ${constraint}`);
    }
  }
  parts.push(`outputRequirements: ${JSON.stringify(reviewBundle.promptContract.outputRequirements)}`);
  parts.push("");
  parts.push("## 文档索引锚点摘要");
  parts.push(`sessionId: ${reviewBundle.indexSummary.sessionId}`);
  parts.push(`indexVersion: ${reviewBundle.indexSummary.indexVersion}`);
  parts.push(`paragraphCount: ${reviewBundle.indexSummary.paragraphCount}`);
  parts.push(`headingCount: ${reviewBundle.indexSummary.headingCount}`);
  if (reviewBundle.changedSectionIds.length > 0) {
    parts.push(`changedSectionIds: ${reviewBundle.changedSectionIds.join(", ")}`);
  }
  parts.push("");
  parts.push("## 章节级正文 Bundle");
  if (focusedBundles.length === 0) {
    parts.push("（没有可审阅章节 bundle）");
  } else {
    for (const bundle of focusedBundles) {
      parts.push(renderSectionBundle(bundle));
      parts.push("");
    }
  }
  parts.push("");

  if (round > 1 && previousFeedbackJson) {
    parts.push("## 上一轮审阅反馈");
    parts.push(previousFeedbackJson);
    parts.push("");
    parts.push("请重点检查上一轮指出的问题是否已修正。");
    parts.push("");
  }

  parts.push(`## 审阅要求`);
  if (focusSectionId) {
    const section = reviewBundle.sectionBundles.find((s) => s.sectionId === focusSectionId);
    const sectionTitle = section ? section.sectionTitle : focusSectionId;
    parts.push(`请重点审阅章节 "${sectionTitle}"（id: ${focusSectionId}），同时检查它与前后内容的连贯性。`);
    parts.push(`sectionFeedback 数组中只需包含 ${focusSectionId} 这一个章节的反馈。`);
  } else {
    parts.push(`这是第 ${round} 轮审阅（最多 2 轮）。请严格按照 JSON 格式输出审阅结果。`);
  }
  if (reviewerLens?.trim()) {
    parts.push(`额外审阅视角：${reviewerLens.trim()}`);
  }

  return parts.join("\n");
}

export const __contextBuilderInternals = {
  renderSectionBundle,
};
