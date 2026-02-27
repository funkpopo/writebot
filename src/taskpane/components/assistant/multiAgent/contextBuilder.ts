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
    parts.push("先调用 get_document_structure，定位当前章节标题对应的段落索引。");
    if (nextSection) {
      parts.push("若已存在下一章节标题，只能修改两者之间的段落范围。");
    } else {
      parts.push("若不存在下一章节标题，只能修改从当前章节标题到文末的内容。");
    }
    parts.push("");
    parts.push("## 修改要求（来自审阅反馈）");
    parts.push(revisionFeedback);
    parts.push("");
    parts.push("请用 select_paragraph + replace_selected_text 精确修改命中的段落，避免重写整篇文档。");
  } else {
    parts.push("");
    parts.push("## 写入约束");
    if (currentIndex === 0) {
      parts.push(`若文档中尚无文章主标题，请先写 # ${outline.title}；然后写本章节标题 ## ${currentSection.title}。`);
    } else {
      parts.push(`请以章节标题 ## ${currentSection.title} 开头，标题文本必须与章节名完全一致。`);
    }
    parts.push("请先用 get_document_structure 了解文档当前结构，然后使用 insert_after_paragraph 在合适位置插入本章节内容。如果文档为空，可使用 append_text。");
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
  reviewerLens?: string,
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
  if (reviewerLens?.trim()) {
    parts.push(`额外审阅视角：${reviewerLens.trim()}`);
  }

  return parts.join("\n");
}
