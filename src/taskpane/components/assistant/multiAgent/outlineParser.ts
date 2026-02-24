import type { ArticleOutline, OutlineSection, ReviewFeedback, SectionFeedback } from "./types";

/**
 * Extract a JSON object from an AI response that may contain fenced code blocks.
 */
function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;

  try {
    const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

// ── Outline parsing ──

function parseSection(raw: unknown, index: number): OutlineSection | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    id: asString(obj.id, `s${index + 1}`),
    title: asString(obj.title, `章节 ${index + 1}`),
    level: asNumber(obj.level, 1),
    description: asString(obj.description, ""),
    keyPoints: asStringArray(obj.keyPoints),
    estimatedParagraphs: asNumber(obj.estimatedParagraphs, 3),
  };
}

export function parseOutlineFromResponse(raw: string): ArticleOutline {
  const json = extractJson(raw);
  if (!json) {
    throw new Error("无法从 Planner 响应中解析出有效的 JSON 大纲");
  }

  const rawSections = Array.isArray(json.sections) ? json.sections : [];
  const sections = rawSections
    .map((s, i) => parseSection(s, i))
    .filter((s): s is OutlineSection => s !== null);

  if (sections.length === 0) {
    throw new Error("大纲中没有有效的章节");
  }

  const outline: ArticleOutline = {
    title: asString(json.title, "未命名文章"),
    theme: asString(json.theme, ""),
    targetAudience: asString(json.targetAudience, "通用读者"),
    style: asString(json.style, "专业"),
    sections,
    totalEstimatedParagraphs: asNumber(
      json.totalEstimatedParagraphs,
      sections.reduce((sum, s) => sum + s.estimatedParagraphs, 0),
    ),
  };

  return outline;
}

// ── Review feedback parsing ──

function parseSectionFeedback(raw: unknown): SectionFeedback | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const sectionId = asString(obj.sectionId, "");
  if (!sectionId) return null;
  return {
    sectionId,
    issues: asStringArray(obj.issues),
    suggestions: asStringArray(obj.suggestions),
    needsRevision: Boolean(obj.needsRevision),
  };
}

export function parseReviewFeedback(raw: string, round: number): ReviewFeedback {
  const json = extractJson(raw);
  if (!json) {
    throw new Error("无法从 Reviewer 响应中解析出有效的 JSON 审阅反馈");
  }

  const rawFeedback = Array.isArray(json.sectionFeedback) ? json.sectionFeedback : [];
  const sectionFeedback = rawFeedback
    .map((f) => parseSectionFeedback(f))
    .filter((f): f is SectionFeedback => f !== null);

  return {
    round: asNumber(json.round, round),
    overallScore: Math.min(10, Math.max(1, asNumber(json.overallScore, 5))),
    sectionFeedback,
    coherenceIssues: asStringArray(json.coherenceIssues),
    globalSuggestions: asStringArray(json.globalSuggestions),
  };
}
