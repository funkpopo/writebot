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
): string {
  const parts: string[] = [];

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
    parts.push("## 修改要求（来自审阅反馈）");
    parts.push(revisionFeedback);
    parts.push("");
    parts.push("请先用 get_document_text 读取当前文档，定位本章节内容，然后用 select_paragraph + replace_selected_text 进行精确修改。");
  } else {
    parts.push("");
    parts.push("请先用 get_document_structure 了解文档当前结构，然后使用 insert_after_paragraph 在合适位置插入本章节内容。如果文档为空，可使用 append_text。");
  }

  return parts.join("\n");
}

/**
 * Build the user message for the Reviewer agent.
 * When focusSectionId is provided, the reviewer focuses on that section only.
 */
export function buildReviewContext(
  outline: ArticleOutline,
  documentText: string,
  round: number,
  previousFeedbackJson?: string,
  focusSectionId?: string,
): string {
  const parts: string[] = [];

  parts.push("## 文章大纲");
  parts.push(JSON.stringify(outline, null, 2));
  parts.push("");
  parts.push("## 当前文档全文");
  parts.push(documentText || "（空文档）");
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
    const section = outline.sections.find((s) => s.id === focusSectionId);
    const sectionTitle = section ? section.title : focusSectionId;
    parts.push(`请重点审阅章节 "${sectionTitle}"（id: ${focusSectionId}），同时检查它与前后内容的连贯性。`);
    parts.push(`sectionFeedback 数组中只需包含 ${focusSectionId} 这一个章节的反馈。`);
  } else {
    parts.push(`这是第 ${round} 轮审阅（最多 2 轮）。请严格按照 JSON 格式输出审阅结果。`);
  }

  return parts.join("\n");
}
