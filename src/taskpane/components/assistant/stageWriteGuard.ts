export interface StageWriteGuardContext {
  currentStage: number;
  totalStages: number;
  planStageTitles: string[];
}

export interface StageWriteGuardResult {
  text: string;
  removedMarker: boolean;
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
  context: StageWriteGuardContext
): StageWriteGuardResult {
  const source = typeof rawText === "string" ? rawText : String(rawText ?? "");
  if (!source.trim()) {
    return { text: source, removedMarker: false };
  }

  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  let removedMarker = false;
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
    if (directive && shouldStripStageDirective(directive, context)) {
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
  return { text: stripped, removedMarker: true };
}
