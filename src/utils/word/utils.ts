/* global Word */

import { VALID_ALIGNMENTS, COLOR_NAME_MAP, LineSpacingRule, FontFormat, ParagraphFormat, MarkdownHeadingStyleTarget } from "./types";

/**
 * 将alignment字符串转换为Word.Alignment枚举值
 */
export function toWordAlignment(alignment: string | undefined): Word.Alignment | undefined {
  if (!alignment) return undefined;
  const normalized = alignment.toLowerCase();
  switch (normalized) {
    case "left":
      return Word.Alignment.left;
    case "center":
    case "centered":
      return Word.Alignment.centered;
    case "right":
      return Word.Alignment.right;
    case "justify":
    case "justified":
      return Word.Alignment.justified;
    default:
      // 如果是有效的Word.Alignment值，直接返回
      if (VALID_ALIGNMENTS.includes(alignment)) {
        return alignment as Word.Alignment;
      }
      return undefined;
  }
}

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y", "是", "对"].includes(normalized)) return true;
    if (["false", "no", "0", "n", "否", "不"].includes(normalized)) return false;
  }
  return undefined;
}

export function clampNumber(value: number, min?: number, max?: number): number {
  let clamped = value;
  if (min !== undefined) clamped = Math.max(min, clamped);
  if (max !== undefined) clamped = Math.min(max, clamped);
  return clamped;
}

export function normalizeColorValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const hex6Match = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (hex6Match) {
    return `#${hex6Match[1].toUpperCase()}`;
  }

  const hex3Match = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (hex3Match) {
    const h = hex3Match[1];
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }

  const rgbMatch = trimmed.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i
  );
  if (rgbMatch) {
    const r = clampNumber(parseInt(rgbMatch[1], 10), 0, 255);
    const g = clampNumber(parseInt(rgbMatch[2], 10), 0, 255);
    const b = clampNumber(parseInt(rgbMatch[3], 10), 0, 255);
    const toHex = (num: number) => num.toString(16).padStart(2, "0").toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const normalizedKey = trimmed.toLowerCase();
  if (normalizedKey === "auto" || normalizedKey === "automatic") return undefined;
  if (COLOR_NAME_MAP[normalizedKey]) return COLOR_NAME_MAP[normalizedKey];

  return undefined;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index !== -1) {
    index = haystack.indexOf(needle, index);
    if (index !== -1) {
      count += 1;
      index += needle.length;
    }
  }
  return count;
}

/**
 * 简单哈希函数
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function normalizeLineSpacingRule(value: unknown): LineSpacingRule | undefined {
  if (value === "multiple" || value === "exactly" || value === "atLeast") {
    return value;
  }
  return undefined;
}

/**
 * 计算实际行距值（以磅为单位）
 * Word JavaScript API 的 lineSpacing 属性只接受固定磅值
 * 对于多倍行距，需要根据字体大小计算实际磅值
 */
export function calculateLineSpacingInPoints(
  lineSpacing: number,
  lineSpacingRule: LineSpacingRule | undefined,
  fontSize: number
): number {
  const rule = lineSpacingRule || "multiple";

  switch (rule) {
    case "multiple":
      // 多倍行距：行距值 * 字体大小 * 1.2（Word 默认单倍行距约为字体大小的 1.2 倍）
      // 例如：1.5 倍行距，12pt 字体 = 1.5 * 12 * 1.2 = 21.6pt
      return lineSpacing * fontSize * 1.2;
    case "exactly":
    case "atLeast":
      // 固定值或最小值：直接使用磅值
      return lineSpacing;
    default:
      return lineSpacing * fontSize * 1.2;
  }
}

export function resolveLineSpacingPoints(
  lineSpacing: number,
  lineSpacingRule: LineSpacingRule | undefined,
  fontSize: number
): number | undefined {
  if (!Number.isFinite(lineSpacing) || lineSpacing <= 0) return undefined;
  const rule = lineSpacingRule || "multiple";

  if (rule === "multiple") {
    // 如果值明显是磅值（例如 18），直接使用避免被重复换算
    if (lineSpacing > 6) {
      return lineSpacing;
    }
    const effectiveFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12;
    const computed = calculateLineSpacingInPoints(lineSpacing, rule, effectiveFontSize);
    return Number.isFinite(computed) && computed > 0 ? computed : undefined;
  }

  return lineSpacing;
}

/**
 * 计算首行缩进值（以磅为单位）
 * 中文文档通常使用"字符"作为缩进单位（如首行缩进2字符）
 * 需要根据字体大小转换为磅值
 * @param indentChars 缩进字符数
 * @param fontSize 字体大小（磅）
 * @returns 缩进的磅值
 */
export function calculateIndentInPoints(indentChars: number, fontSize: number): number {
  // 中文字符宽度约等于字体大小
  return indentChars * fontSize;
}

export function normalizeHeadingMatchText(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyFontFormat(targetFont: Word.Font, format: FontFormat): void {
  if (format.name) targetFont.name = format.name;
  if (format.size !== undefined) targetFont.size = format.size;
  if (format.bold !== undefined) targetFont.bold = format.bold;
  if (format.italic !== undefined) targetFont.italic = format.italic;
  if (format.underline !== undefined) {
    targetFont.underline = format.underline as Word.UnderlineType;
  }
  if (format.strikeThrough !== undefined) {
    targetFont.strikeThrough = format.strikeThrough;
  }
  if (format.color) targetFont.color = format.color;
  if (format.highlightColor !== undefined) {
    targetFont.highlightColor = format.highlightColor as any;
  }
}

export function applyParagraphFormat(targetParagraph: Word.Paragraph, format: ParagraphFormat): void {
  if (format.style) {
    try {
      targetParagraph.style = format.style;
    } catch {
      // Ignore invalid or unavailable style names.
    }
  }

  if (format.alignment) {
    const wordAlignment = toWordAlignment(format.alignment);
    if (wordAlignment) {
      targetParagraph.alignment = wordAlignment;
    }
  }
  if (format.firstLineIndent !== undefined) {
    targetParagraph.firstLineIndent = format.firstLineIndent;
  }
  if (format.leftIndent !== undefined) {
    targetParagraph.leftIndent = format.leftIndent;
  }
  if (format.rightIndent !== undefined) {
    targetParagraph.rightIndent = format.rightIndent;
  }
  if (format.lineSpacing !== undefined) {
    targetParagraph.lineSpacing = format.lineSpacing;
  }
  if (format.spaceBefore !== undefined) {
    targetParagraph.spaceBefore = format.spaceBefore;
  }
  if (format.spaceAfter !== undefined) {
    targetParagraph.spaceAfter = format.spaceAfter;
  }
}

/**
 * 获取默认字体列表（作为后备方案）
 */
export function getDefaultFontList(): string[] {
  return [
    // 中文字体
    "宋体",
    "黑体",
    "楷体",
    "仿宋",
    "微软雅黑",
    "华文宋体",
    "华文黑体",
    "华文楷体",
    "华文仿宋",
    "华文中宋",
    "华文细黑",
    "方正小标宋简体",
    "方正仿宋简体",
    "方正楷体简体",
    "方正黑体简体",
    // 英文字体
    "Times New Roman",
    "Arial",
    "Calibri",
    "Cambria",
    "Georgia",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Garamond",
    "Book Antiqua",
    "Century",
    "Palatino Linotype",
    "Consolas",
    "Courier New",
  ];
}

export function applyBuiltInHeadingStyle(paragraph: Word.Paragraph, level: 1 | 2 | 3): void {
  const paragraphWithBuiltIn = paragraph as Word.Paragraph & { styleBuiltIn?: Word.BuiltInStyleName };
  const builtInCandidates = [`heading${level}`, `Heading${level}`];

  for (const candidate of builtInCandidates) {
    try {
      paragraphWithBuiltIn.styleBuiltIn = candidate as unknown as Word.BuiltInStyleName;
      return;
    } catch {
      // Try next candidate.
    }
  }

  const styleNameCandidates = [`Heading ${level}`];
  for (const styleName of styleNameCandidates) {
    try {
      paragraph.style = styleName;
      return;
    } catch {
      // Try next candidate.
    }
  }
}

export async function applyHeadingStylesToInsertedRange(
  context: Word.RequestContext,
  insertedRange: Word.Range,
  headingTargets: MarkdownHeadingStyleTarget[]
): Promise<void> {
  if (!headingTargets || headingTargets.length === 0) return;

  const paragraphs = insertedRange.paragraphs;
  paragraphs.load("items/text");
  await context.sync();

  if (paragraphs.items.length === 0) return;

  let searchStart = 0;

  for (const heading of headingTargets) {
    const target = normalizeHeadingMatchText(heading.text);
    if (!target) continue;

    let matchedIndex = -1;
    for (let i = searchStart; i < paragraphs.items.length; i++) {
      const paragraphText = normalizeHeadingMatchText(paragraphs.items[i].text);
      if (!paragraphText) continue;

      if (
        paragraphText === target
        || paragraphText.includes(target)
        || target.includes(paragraphText)
      ) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex < 0) continue;

    applyBuiltInHeadingStyle(paragraphs.items[matchedIndex], heading.level);
    searchStart = matchedIndex + 1;
  }

  await context.sync();
}
