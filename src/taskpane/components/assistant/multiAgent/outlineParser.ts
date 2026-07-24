import type {
  ArticleOutline,
  OutlineSection,
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
    || "title" in item
  );
  return preferred || parsedObjects[0];
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${context}.${key} 必须是非空字符串`);
  }
  return value.trim();
}

function requireNumber(obj: Record<string, unknown>, key: string, context: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context}.${key} 必须是有限数字`);
  }
  return value;
}

function requireIntegerInRange(
  obj: Record<string, unknown>,
  key: string,
  context: string,
  min: number,
  max?: number,
): number {
  const value = requireNumber(obj, key, context);
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new Error(
      max === undefined
        ? `${context}.${key} 必须是大于等于 ${min} 的整数`
        : `${context}.${key} 必须是 ${min} 到 ${max} 之间的整数`,
    );
  }
  return value;
}

function requireStringArray(obj: Record<string, unknown>, key: string, context: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${key} 必须是字符串数组`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${context}.${key}[${index}] 必须是非空字符串`);
    }
    return item.trim();
  });
}

function requireRecordArray(obj: Record<string, unknown>, key: string, context: string): Record<string, unknown>[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${key} 必须是对象数组`);
  }
  return value.map((item, index) => requireRecord(item, `${context}.${key}[${index}]`));
}

// ── Outline parsing ──

function parseSection(obj: Record<string, unknown>, index: number): OutlineSection {
  const context = `sections[${index}]`;
  return {
    id: requireString(obj, "id", context),
    title: requireString(obj, "title", context),
    level: requireIntegerInRange(obj, "level", context, 1, 6),
    description: requireString(obj, "description", context),
    keyPoints: requireStringArray(obj, "keyPoints", context),
    estimatedParagraphs: requireIntegerInRange(obj, "estimatedParagraphs", context, 1),
  };
}

export function parseOutlineFromResponse(raw: string): ArticleOutline {
  const json = extractJson(raw);
  if (!json) {
    throw new Error("无法从 Planner 响应中解析出有效的 JSON 大纲");
  }

  const sections = requireRecordArray(json, "sections", "outline").map((section, index) =>
    parseSection(section, index)
  );

  if (sections.length === 0) {
    throw new Error("大纲中没有有效的章节");
  }

  const outline: ArticleOutline = {
    title: requireString(json, "title", "outline"),
    theme: requireString(json, "theme", "outline"),
    targetAudience: requireString(json, "targetAudience", "outline"),
    style: requireString(json, "style", "outline"),
    sections,
    totalEstimatedParagraphs: requireIntegerInRange(json, "totalEstimatedParagraphs", "outline", 1),
  };

  return outline;
}
