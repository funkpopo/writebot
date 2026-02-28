export interface StageWriteGuardContext {
  currentStage: number;
  totalStages: number;
  planStageTitles: string[];
}

export interface StageWriteGuardResult {
  text: string;
  removedMarker: boolean;
}

const SOURCE_ANCHOR_RE =
  /(?:\[\s*来源锚点\s*[:：][^\]\n]+?\]|\(\s*来源锚点\s*[:：][^) \n]+?\)|（\s*来源锚点\s*[:：][^）\n]+?）|【\s*来源锚点\s*[:：][^】\n]+?】)/gu;

export function ensureTrailingNewlineForInsertion(rawText: string): string {
  const source = typeof rawText === "string" ? rawText : String(rawText ?? "");
  if (!source) return source;
  if (/\r?\n$/u.test(source)) return source;
  return `${source}\n`;
}

export function stripSourceAnchorMarkersFromWriteText(rawText: string): StageWriteGuardResult {
  const source = typeof rawText === "string" ? rawText : String(rawText ?? "");
  if (!source.trim()) {
    return { text: source, removedMarker: false };
  }
  const stripped = source.replace(SOURCE_ANCHOR_RE, "").replace(/\n{3,}/g, "\n\n");
  return {
    text: stripped,
    removedMarker: stripped !== source,
  };
}

const CHINESE_DIGIT_MAP: Record<string, number> = {
  "零": 0,
  "〇": 0,
  "一": 1,
  "二": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
};

function parseChineseNumeral(rawToken: string): number | null {
  const token = rawToken.trim();
  if (!token) return null;

  if (/^[零〇一二两三四五六七八九]+$/.test(token)) {
    const digits = Array.from(token)
      .map((char) => CHINESE_DIGIT_MAP[char])
      .filter((digit) => digit !== undefined);
    if (digits.length !== token.length) return null;
    return Number(digits.join(""));
  }

  let value = 0;
  let pendingDigit = 0;

  for (const char of token) {
    if (char === "十" || char === "百" || char === "千") {
      const unit = char === "十" ? 10 : char === "百" ? 100 : 1000;
      const digit = pendingDigit === 0 ? 1 : pendingDigit;
      value += digit * unit;
      pendingDigit = 0;
      continue;
    }

    const mapped = CHINESE_DIGIT_MAP[char];
    if (mapped === undefined) return null;
    pendingDigit = mapped;
  }

  value += pendingDigit;
  return value > 0 ? value : null;
}

function parseStageTokenToNumber(token: string): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return parseChineseNumeral(trimmed);
}

function normalizeComparableText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~#>\-\s:：、，。,.!！?？;；"'“”‘’（）()【】\[\]<>]/g, "");
}

function parseStageDirectiveLine(rawLine: string): { stageNumber: number | null; title: string } | null {
  const line = rawLine
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .trim();

  if (!line.includes("阶段")) return null;

  const currentMatch = line.match(/^当前阶段(?:\s*[:：\-—]\s*(.*))?$/u);
  if (currentMatch) {
    return {
      stageNumber: null,
      title: (currentMatch[1] || "").trim(),
    };
  }

  const stageMatch = line.match(
    /^(?:第\s*([0-9一二两三四五六七八九十百千〇零]+)\s*阶段|阶段\s*([0-9一二两三四五六七八九十百千〇零]+))(?:(?:\s*[:：\-—]\s*|\s+)(.*))?$/u
  );
  if (!stageMatch) return null;

  const stageToken = (stageMatch[1] || stageMatch[2] || "").trim();
  return {
    stageNumber: parseStageTokenToNumber(stageToken),
    title: (stageMatch[3] || "").trim(),
  };
}

function isLikelyPlanStageTitle(title: string, planStageTitles: string[]): boolean {
  const candidate = normalizeComparableText(title);
  if (!candidate || candidate.length < 4) return false;
  return planStageTitles.some((planTitle) => {
    const normalizedPlan = normalizeComparableText(planTitle);
    if (!normalizedPlan || normalizedPlan.length < 4) return false;
    return normalizedPlan.includes(candidate) || candidate.includes(normalizedPlan);
  });
}

function shouldStripStageDirective(
  directive: { stageNumber: number | null; title: string },
  context: StageWriteGuardContext
): boolean {
  const { stageNumber, title } = directive;

  if (stageNumber === context.currentStage) return true;
  if (stageNumber !== null && stageNumber >= 1 && stageNumber <= context.totalStages) {
    if (!title) return true;
    if (isLikelyPlanStageTitle(title, context.planStageTitles)) return true;
  }

  if (title && isLikelyPlanStageTitle(title, context.planStageTitles)) {
    return true;
  }

  return false;
}

function isAgentControlTagLine(line: string): boolean {
  return /^\[\[(PLAN_STATE|STATUS|CONTENT)\]\]$/i.test(line.trim());
}

/**
 * Remove [[PLAN_STATE]] (+ JSON body), [[STATUS]], and [[CONTENT]] blocks
 * from **anywhere** in the text – not just the prefix.
 */
function stripAllAgentControlBlocks(source: string): { text: string; removed: boolean } {
  let result = source;
  let removed = false;

  // 1. Strip [[PLAN_STATE]] + the JSON object that follows it
  const planStateRe = /\[\[PLAN_STATE\]\]\s*(?:```(?:json)?\s*)?\{[\s\S]*?\}(?:\s*```)?\s*/gi;
  const afterPlanState = result.replace(planStateRe, "\n");
  if (afterPlanState !== result) {
    removed = true;
    result = afterPlanState;
  }

  // 2. Strip [[STATUS]] ... (up to next [[tag]] or end)
  const statusRe = /\[\[STATUS\]\][^\[]*?(?=\[\[|$)/gi;
  const afterStatus = result.replace(statusRe, "\n");
  if (afterStatus !== result) {
    removed = true;
    result = afterStatus;
  }

  // 3. Strip [[CONTENT]] ... (up to next [[tag]] or end)
  const contentRe = /\[\[CONTENT\]\][^\[]*?(?=\[\[|$)/gi;
  const afterContent = result.replace(contentRe, "\n");
  if (afterContent !== result) {
    removed = true;
    result = afterContent;
  }

  // Collapse excessive blank lines left behind
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return { text: result, removed };
}

/**
 * Detect whether the text is a stage-completion report (plan metadata)
 * rather than actual document content.
 */
function isStageCompletionReport(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Quick check: if the text is very long (>2000 chars) it's likely real content
  if (trimmed.length > 2000) return false;

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return true;

  // Check first line for stage completion pattern
  const firstLine = lines[0].trim();
  const stageCompletionStart =
    /^第\s*[0-9一二两三四五六七八九十]+\s*阶段\s*(?:已)?完成\s*[：:]/u.test(firstLine);

  if (!stageCompletionStart) return false;

  // If it starts with a stage completion pattern, check if the rest is
  // accomplishment summaries (numbered items with colons) or plan references
  const planRefPatterns = [
    /plan\.md/i,
    /根据.*(?:要求|计划)/,
    /按照.*(?:要求|计划)/,
    /已经完成了/,
    /当前文档已经/,
    /为后续阶段/,
    /奠定了.*基础/,
    /已完成.*阶段/,
    /阶段.*已完成/,
  ];

  let planRefCount = 0;
  let numberedSummaryCount = 0;

  for (const line of lines) {
    const t = line.trim();
    if (planRefPatterns.some((re) => re.test(t))) planRefCount++;
    // Numbered items like "1. XXX：..." or "1.\tXXX：..."
    if (/^\d+[.、)\t]\s*.+[：:]/.test(t)) numberedSummaryCount++;
  }

  // If we see plan references or the majority of lines are numbered summaries,
  // this is a stage completion report
  return planRefCount >= 1 || numberedSummaryCount >= Math.max(2, lines.length * 0.4);
}

export function extractPlanStageTitles(planMarkdown: string): string[] {
  const titles: string[] = [];
  const lines = planMarkdown.split(/\r?\n/g);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const numberedMatch = line.match(/^(\d+)\.\s*(?:\[[ xX]\]\s*)?(.+)$/);
    const checklistMatch = line.match(/^[-*]\s*\[[ xX]\]\s+(.+)$/);
    const title = (numberedMatch?.[2] || checklistMatch?.[1] || "").trim();
    if (!title) continue;
    if (!titles.includes(title)) {
      titles.push(title);
    }
  }
  return titles;
}

export function stripAgentExecutionMarkersFromWriteText(
  rawText: string,
  context?: StageWriteGuardContext
): StageWriteGuardResult {
  const source = typeof rawText === "string" ? rawText : String(rawText ?? "");
  if (!source.trim()) {
    return { text: source, removedMarker: false };
  }
  const effectiveContext: StageWriteGuardContext = context || {
    currentStage: 0,
    totalStages: 0,
    planStageTitles: [],
  };

  // ── Phase 1: strip control blocks ([[PLAN_STATE]], [[STATUS]], [[CONTENT]]) from anywhere ──
  const { text: afterControlStrip, removed: controlRemoved } = stripAllAgentControlBlocks(source);

  // ── Phase 2: check if the entire (remaining) text is a stage-completion report ──
  if (controlRemoved && isStageCompletionReport(afterControlStrip)) {
    return { text: "", removedMarker: true };
  }

  // ── Phase 3: prefix-strip stage directives and any remaining control tag lines ──
  const working = afterControlStrip.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = working.split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  let removedMarker = controlRemoved;
  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      cursor += 1;
      continue;
    }

    if (isAgentControlTagLine(line)) {
      removedMarker = true;
      cursor += 1;
      continue;
    }

    const directive = parseStageDirectiveLine(line);
    if (directive && shouldStripStageDirective(directive, effectiveContext)) {
      removedMarker = true;
      cursor += 1;
      while (cursor < lines.length && !lines[cursor].trim()) {
        cursor += 1;
      }
      continue;
    }
    break;
  }

  if (!removedMarker) {
    return { text: source, removedMarker: false };
  }

  const stripped = lines.slice(cursor).join("\n").trimStart();

  // ── Phase 4: final check – if after all stripping the remainder is a report, discard it ──
  if (isStageCompletionReport(stripped)) {
    return { text: "", removedMarker: true };
  }

  return { text: stripped, removedMarker: true };
}
