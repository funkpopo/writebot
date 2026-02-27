import type { ArticleOutline, OutlineSection } from "./types";

export interface GlossaryMemoryItem {
  term: string;
  note: string;
  frequency: number;
}

export interface SectionSummaryMemory {
  sectionId: string;
  sectionTitle: string;
  summary: string;
  keywords: string[];
  updatedAt: string;
}

export interface LongTermMemoryState {
  personas: string[];
  glossary: GlossaryMemoryItem[];
  sectionSummaries: SectionSummaryMemory[];
}

interface SerializedLongTermMemorySnapshot {
  updatedAt: string;
  memory: LongTermMemoryState;
}

const STOP_WORDS = new Set([
  "以及",
  "然后",
  "因此",
  "所以",
  "这个",
  "那个",
  "我们",
  "你们",
  "他们",
  "进行",
  "可以",
  "需要",
  "文章",
  "章节",
  "内容",
  "current",
  "section",
  "with",
  "from",
  "that",
  "this",
  "into",
  "about",
]);

function compactText(input: string, maxLength: number): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractKeywords(text: string, maxCount = 12): string[] {
  const matches = text.match(/[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z0-9_-]{2,}/g) || [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const raw of matches) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (STOP_WORDS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(normalized);
    if (keywords.length >= maxCount) break;
  }

  return keywords;
}

function pickSectionSummary(section: OutlineSection, content: string): string {
  const lines = splitLines(content)
    .filter((line) => !line.startsWith("#"));
  if (lines.length === 0) {
    return compactText(section.description, 220);
  }
  const merged = lines.slice(0, 2).join(" ");
  return compactText(merged, 220);
}

function normalizeTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[“”"'`]/g, "")
    .replace(/^[\W_]+|[\W_]+$/g, "");
}

function extractCandidateTerms(text: string): string[] {
  const terms = new Set<string>();
  const quotedMatches = text.match(/[“"']([^“”"'`\n]{2,30})[”"']/g) || [];
  const upperMatches = text.match(/\b[A-Z][A-Za-z0-9_-]{1,30}\b/g) || [];
  const cnTitleMatches = text.match(/[《【]([^》】\n]{2,30})[》】]/g) || [];

  for (const quoted of quotedMatches) {
    const term = normalizeTerm(quoted.replace(/^[“"']|[”"']$/g, ""));
    if (term) terms.add(term);
  }
  for (const upper of upperMatches) {
    const term = normalizeTerm(upper);
    if (term.length >= 2) terms.add(term);
  }
  for (const cnTitle of cnTitleMatches) {
    const term = normalizeTerm(cnTitle.replace(/^[《【]|[》】]$/g, ""));
    if (term) terms.add(term);
  }

  return Array.from(terms).slice(0, 10);
}

function upsertGlossary(
  glossary: GlossaryMemoryItem[],
  term: string,
  note: string,
): void {
  const normalizedTerm = normalizeTerm(term);
  if (!normalizedTerm) return;

  const existingIndex = glossary.findIndex((item) => item.term.toLowerCase() === normalizedTerm.toLowerCase());
  if (existingIndex >= 0) {
    const existing = glossary[existingIndex];
    glossary[existingIndex] = {
      ...existing,
      frequency: existing.frequency + 1,
      note: existing.note || note,
    };
    return;
  }

  glossary.push({
    term: normalizedTerm,
    note: compactText(note, 80),
    frequency: 1,
  });
}

function scoreSummaryMatch(
  summaryKeywords: string[],
  sectionKeywords: string[],
): number {
  if (sectionKeywords.length === 0 || summaryKeywords.length === 0) return 0;
  const set = new Set(summaryKeywords);
  let overlap = 0;
  for (const keyword of sectionKeywords) {
    if (set.has(keyword)) overlap += 1;
  }
  return overlap;
}

function normalizeLongTermMemoryState(value: Partial<LongTermMemoryState>): LongTermMemoryState {
  const personas = Array.isArray(value.personas)
    ? value.personas
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : [];

  const glossary = Array.isArray(value.glossary)
    ? value.glossary
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Partial<GlossaryMemoryItem>;
        const term = typeof record.term === "string" ? normalizeTerm(record.term) : "";
        if (!term) return null;
        return {
          term,
          note: typeof record.note === "string" ? compactText(record.note, 120) : "",
          frequency:
            typeof record.frequency === "number" && Number.isFinite(record.frequency)
              ? Math.max(1, Math.floor(record.frequency))
              : 1,
        } satisfies GlossaryMemoryItem;
      })
      .filter((item): item is GlossaryMemoryItem => Boolean(item))
    : [];

  const sectionSummaries = Array.isArray(value.sectionSummaries)
    ? value.sectionSummaries
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Partial<SectionSummaryMemory>;
        const sectionId = typeof record.sectionId === "string" ? record.sectionId.trim() : "";
        const sectionTitle = typeof record.sectionTitle === "string" ? record.sectionTitle.trim() : "";
        if (!sectionId || !sectionTitle) return null;
        const summary = typeof record.summary === "string" ? compactText(record.summary, 240) : "";
        const keywords = Array.isArray(record.keywords)
          ? Array.from(
            new Set(
              record.keywords
                .filter((keyword) => typeof keyword === "string")
                .map((keyword) => keyword.trim().toLowerCase())
                .filter((keyword) => keyword.length > 0),
            ),
          ).slice(0, 16)
          : [];
        const updatedAtCandidate = typeof record.updatedAt === "string" ? record.updatedAt : "";
        const updatedAt = updatedAtCandidate.trim()
          ? updatedAtCandidate
          : new Date().toISOString();
        return {
          sectionId,
          sectionTitle,
          summary,
          keywords,
          updatedAt,
        } satisfies SectionSummaryMemory;
      })
      .filter((item): item is SectionSummaryMemory => Boolean(item))
    : [];

  return {
    personas: Array.from(new Set(personas)).slice(0, 12),
    glossary,
    sectionSummaries,
  };
}

function parseSnapshotFromMarkdown(markdown: string): SerializedLongTermMemorySnapshot | null {
  const match = markdown.match(/```writebot-memory\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<SerializedLongTermMemorySnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    const memorySource =
      parsed.memory && typeof parsed.memory === "object"
        ? parsed.memory
        : (parsed as unknown as Partial<LongTermMemoryState>);
    return {
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt
          : new Date().toISOString(),
      memory: normalizeLongTermMemoryState(memorySource),
    };
  } catch {
    return null;
  }
}

function parseIsoTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createLongTermMemory(
  outline: ArticleOutline,
  userRequirement: string,
  documentContext: string,
): LongTermMemoryState {
  const personas = [
    `目标读者：${outline.targetAudience}`,
    `写作风格：${outline.style}`,
    outline.theme ? `核心主题：${outline.theme}` : "",
  ].filter(Boolean);

  const glossary: GlossaryMemoryItem[] = [];
  const seedTerms = extractCandidateTerms(`${userRequirement}\n${documentContext}`);
  for (const term of seedTerms) {
    upsertGlossary(glossary, term, "来自用户需求或已有文档");
  }

  return {
    personas,
    glossary,
    sectionSummaries: [],
  };
}

export function mergeLongTermMemory(
  target: LongTermMemoryState,
  incoming: Partial<LongTermMemoryState>,
): void {
  const normalizedIncoming = normalizeLongTermMemoryState(incoming);

  const mergedPersonas = Array.from(
    new Set([
      ...target.personas.map((item) => item.trim()).filter(Boolean),
      ...normalizedIncoming.personas,
    ]),
  );
  target.personas = mergedPersonas.slice(0, 12);

  const glossaryMap = new Map<string, GlossaryMemoryItem>();
  for (const item of target.glossary) {
    glossaryMap.set(item.term.toLowerCase(), { ...item });
  }
  for (const item of normalizedIncoming.glossary) {
    const key = item.term.toLowerCase();
    const existing = glossaryMap.get(key);
    if (!existing) {
      glossaryMap.set(key, { ...item });
      continue;
    }
    glossaryMap.set(key, {
      term: existing.term,
      note: existing.note || item.note,
      frequency: Math.max(1, existing.frequency + item.frequency),
    });
  }
  target.glossary = Array.from(glossaryMap.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 120);

  const summaryMap = new Map<string, SectionSummaryMemory>();
  for (const item of target.sectionSummaries) {
    summaryMap.set(item.sectionId, { ...item });
  }
  for (const item of normalizedIncoming.sectionSummaries) {
    const existing = summaryMap.get(item.sectionId);
    if (!existing) {
      summaryMap.set(item.sectionId, { ...item });
      continue;
    }
    const shouldReplace = parseIsoTime(item.updatedAt) >= parseIsoTime(existing.updatedAt);
    if (shouldReplace) {
      summaryMap.set(item.sectionId, {
        ...item,
        keywords: Array.from(new Set([...existing.keywords, ...item.keywords])).slice(0, 16),
      });
    } else {
      summaryMap.set(item.sectionId, {
        ...existing,
        keywords: Array.from(new Set([...existing.keywords, ...item.keywords])).slice(0, 16),
      });
    }
  }
  target.sectionSummaries = Array.from(summaryMap.values())
    .sort((a, b) => parseIsoTime(b.updatedAt) - parseIsoTime(a.updatedAt))
    .slice(0, 120);
}

export function updateLongTermMemoryWithSection(
  memory: LongTermMemoryState,
  section: OutlineSection,
  sectionContent: string,
): void {
  const summary = pickSectionSummary(section, sectionContent);
  const keywords = extractKeywords(
    `${section.title}\n${section.description}\n${section.keyPoints.join("\n")}\n${summary}`,
    14,
  );
  const updatedAt = new Date().toISOString();

  const summaryEntry: SectionSummaryMemory = {
    sectionId: section.id,
    sectionTitle: section.title,
    summary,
    keywords,
    updatedAt,
  };

  const existingIndex = memory.sectionSummaries.findIndex((item) => item.sectionId === section.id);
  if (existingIndex >= 0) {
    memory.sectionSummaries[existingIndex] = summaryEntry;
  } else {
    memory.sectionSummaries.push(summaryEntry);
  }

  const candidateTerms = extractCandidateTerms(
    `${section.title}\n${section.keyPoints.join("\n")}\n${sectionContent}`
  );
  for (const term of candidateTerms) {
    upsertGlossary(memory.glossary, term, `来自章节：${section.title}`);
  }
}

export function buildMemoryContextForSection(
  memory: LongTermMemoryState,
  section: OutlineSection,
): string {
  const sectionKeywords = extractKeywords(
    `${section.title}\n${section.description}\n${section.keyPoints.join("\n")}`,
    16,
  );

  const scoredSummaries = memory.sectionSummaries
    .map((item) => ({
      item,
      score: scoreSummaryMatch(item.keywords, sectionKeywords),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.item.updatedAt.localeCompare(a.item.updatedAt);
    })
    .slice(0, 3)
    .map((entry) => entry.item);

  let glossaryCandidates = memory.glossary
    .filter((item) => {
      const lowerTerm = item.term.toLowerCase();
      return sectionKeywords.some((keyword) => keyword.includes(lowerTerm) || lowerTerm.includes(keyword));
    })
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 8);

  if (glossaryCandidates.length === 0) {
    glossaryCandidates = [...memory.glossary]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);
  }

  const parts: string[] = [];
  if (memory.personas.length > 0) {
    parts.push("### 角色/语气设定");
    for (const persona of memory.personas.slice(0, 3)) {
      parts.push(`- ${persona}`);
    }
  }

  if (glossaryCandidates.length > 0) {
    parts.push("### 术语表");
    for (const term of glossaryCandidates) {
      parts.push(`- ${term.term}：${term.note}`);
    }
  }

  if (scoredSummaries.length > 0) {
    parts.push("### 相关章节摘要");
    for (const item of scoredSummaries) {
      parts.push(`- ${item.sectionTitle}：${item.summary}`);
    }
  }

  return parts.join("\n");
}

export function renderLongTermMemoryMarkdown(
  memory: LongTermMemoryState,
  updatedAt = new Date().toISOString(),
): string {
  const normalized = normalizeLongTermMemoryState(memory);
  const lines: string[] = [
    "# WriteBot Memory",
    "",
    "> 由 WriteBot 自动维护。你可以查看该文件，但不建议手工修改 Snapshot 块。",
    "",
    "## Personas",
  ];

  if (normalized.personas.length === 0) {
    lines.push("- (empty)");
  } else {
    for (const persona of normalized.personas) {
      lines.push(`- ${persona}`);
    }
  }

  lines.push("", "## Glossary");
  if (normalized.glossary.length === 0) {
    lines.push("- (empty)");
  } else {
    for (const item of normalized.glossary.slice(0, 80)) {
      lines.push(`- ${item.term} | frequency: ${item.frequency} | note: ${item.note || "-"}`);
    }
  }

  lines.push("", "## Section Summaries");
  if (normalized.sectionSummaries.length === 0) {
    lines.push("- (empty)");
  } else {
    for (const item of normalized.sectionSummaries.slice(0, 80)) {
      lines.push(`### ${item.sectionTitle} [${item.sectionId}]`);
      lines.push(`- summary: ${item.summary || "-"}`);
      lines.push(`- keywords: ${item.keywords.join(", ") || "-"}`);
      lines.push(`- updatedAt: ${item.updatedAt}`);
      lines.push("");
    }
    while (lines[lines.length - 1] === "") {
      lines.pop();
    }
  }

  const snapshot: SerializedLongTermMemorySnapshot = {
    updatedAt,
    memory: normalized,
  };

  lines.push(
    "",
    "## Updated",
    `- ${updatedAt}`,
    "",
    "## Snapshot",
    "```writebot-memory",
    JSON.stringify(snapshot, null, 2),
    "```",
    "",
  );

  return lines.join("\n");
}

export function parseLongTermMemoryMarkdown(markdown: string): LongTermMemoryState | null {
  const snapshot = parseSnapshotFromMarkdown(markdown);
  if (!snapshot) return null;
  return snapshot.memory;
}

export const __longTermMemoryInternals = {
  extractKeywords,
  extractCandidateTerms,
  pickSectionSummary,
  normalizeLongTermMemoryState,
  parseSnapshotFromMarkdown,
};
