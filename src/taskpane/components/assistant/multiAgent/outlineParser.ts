import type {
  ArticleOutline,
  OutlineSection,
  ReviewFeedback,
  SectionFeedback,
  VerificationClaim,
  VerificationEvidence,
  VerificationFeedback,
} from "./types";

function extractJsonObjectsFromText(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth <= 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

/**
 * Extract a JSON object from an AI response that may contain fenced code blocks
 * and extra commentary.
 */
function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fencedBlocks = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const block of fencedBlocks) {
    const content = (block[1] || "").trim();
    if (content) candidates.push(content);
  }

  const parsedObjects: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    // Fast path: the whole block is JSON.
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedObjects.push(parsed);
      }
    } catch {
      // Try extracting balanced JSON objects.
    }

    const objects = extractJsonObjectsFromText(candidate);
    for (const objectText of objects) {
      try {
        const parsed = JSON.parse(objectText) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsedObjects.push(parsed);
        }
      } catch {
        // Continue trying next object candidate.
      }
    }
  }

  if (parsedObjects.length === 0) return null;

  const preferred = parsedObjects.find((item) =>
    "sections" in item
    || "sectionFeedback" in item
    || "overallScore" in item
    || "coherenceIssues" in item
    || "claims" in item
    || "evidence" in item
    || "verdict" in item
    || "title" in item
  );
  return preferred || parsedObjects[0];
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

function normalizeVerdict(value: unknown, fallback: "pass" | "fail" = "fail"): "pass" | "fail" {
  return value === "pass" ? "pass" : value === "fail" ? "fail" : fallback;
}

function parseVerificationEvidence(raw: unknown, index: number): VerificationEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id, `e${index + 1}`);
  const quote = asString(obj.quote, "");
  const anchor = asString(obj.anchor, "");
  if (!quote || !anchor) return null;
  return { id, quote, anchor };
}

function parseVerificationClaim(raw: unknown): VerificationClaim | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const claim = asString(obj.claim, "");
  if (!claim) return null;
  return {
    claim,
    verdict: normalizeVerdict(obj.verdict, "fail"),
    evidenceIds: asStringArray(obj.evidenceIds),
    sourceAnchors: asStringArray(obj.sourceAnchors),
    reason: asString(obj.reason, "") || undefined,
  };
}

export function parseVerificationFeedback(raw: string): VerificationFeedback {
  const json = extractJson(raw);
  if (!json) {
    throw new Error("无法从 Verifier 响应中解析出有效的 JSON 核验反馈");
  }

  const evidence = (Array.isArray(json.evidence) ? json.evidence : [])
    .map((item, index) => parseVerificationEvidence(item, index))
    .filter((item): item is VerificationEvidence => item !== null);
  const claims = (Array.isArray(json.claims) ? json.claims : [])
    .map((item) => parseVerificationClaim(item))
    .filter((item): item is VerificationClaim => item !== null);

  const claimHasFailure = claims.some((item) => item.verdict === "fail");
  const topLevelVerdict = normalizeVerdict(json.verdict, claimHasFailure ? "fail" : "pass");
  const evidenceAnchorSet = new Set(evidence.map((item) => item.anchor));

  const normalizedClaims = claims.map((item) => ({
    ...item,
    verdict: item.sourceAnchors.length > 0 ? item.verdict : "fail" as const,
    sourceAnchors: item.sourceAnchors.filter((anchor) => evidenceAnchorSet.has(anchor) || anchor.trim().length > 0),
  }));
  const normalizedVerdict = normalizedClaims.length === 0 || normalizedClaims.some((item) => item.verdict === "fail")
    ? "fail"
    : topLevelVerdict;

  return {
    verdict: normalizedVerdict,
    claims: normalizedClaims,
    evidence,
  };
}
