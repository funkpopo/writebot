import type { ArticleOutline, OutlineSection } from "./types";

export interface OutlineValidationResult {
  outline: ArticleOutline | null;
  error?: string;
}

export function cloneOutline(outline: ArticleOutline): ArticleOutline {
  return {
    ...outline,
    sections: outline.sections.map((section) => ({
      ...section,
      keyPoints: [...section.keyPoints],
    })),
    hardConstraints: outline.hardConstraints ? [...outline.hardConstraints] : undefined,
    outputRequirements: outline.outputRequirements ? { ...outline.outputRequirements } : undefined,
  };
}

function cleanKeyPoint(value: string): string {
  return value.replace(/^\s*[-*•]\s*/u, "").trim();
}

function normalizeSection(section: OutlineSection, index: number, usedIds: Set<string>): OutlineSection {
  const fallbackId = `s${index + 1}`;
  let id = section.id.trim() || fallbackId;
  if (usedIds.has(id)) {
    let suffix = 2;
    while (usedIds.has(`${id}_${suffix}`)) suffix += 1;
    id = `${id}_${suffix}`;
  }
  usedIds.add(id);

  return {
    ...section,
    id,
    title: section.title.trim(),
    description: section.description.trim(),
    keyPoints: section.keyPoints.map(cleanKeyPoint).filter(Boolean),
    level: Math.min(6, Math.max(1, Math.round(section.level || 1))),
    estimatedParagraphs: Math.min(20, Math.max(1, Math.round(section.estimatedParagraphs || 1))),
  };
}

export function validateAndNormalizeOutline(draft: ArticleOutline): OutlineValidationResult {
  const title = draft.title.trim();
  if (!title) return { outline: null, error: "文章标题不能为空。" };

  const targetAudience = draft.targetAudience.trim();
  if (!targetAudience) return { outline: null, error: "目标读者不能为空。" };

  const style = draft.style.trim();
  if (!style) return { outline: null, error: "写作风格不能为空。" };

  if (draft.sections.length === 0) {
    return { outline: null, error: "大纲至少需要一个章节。" };
  }

  const usedIds = new Set<string>();
  const sections = draft.sections.map((section, index) => normalizeSection(section, index, usedIds));
  const emptySectionIndex = sections.findIndex((section) => !section.title);
  if (emptySectionIndex >= 0) {
    return { outline: null, error: `第 ${emptySectionIndex + 1} 个章节的标题不能为空。` };
  }

  return {
    outline: {
      ...draft,
      title,
      theme: draft.theme.trim(),
      targetAudience,
      style,
      sections,
      totalEstimatedParagraphs: sections.reduce(
        (total, section) => total + section.estimatedParagraphs,
        0,
      ),
    },
  };
}
