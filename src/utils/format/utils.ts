/**
 * AI排版服务 - 共享工具函数与模块级状态
 */

import {
  ParagraphInfo,
  FormatSpecification,
  FontFormat,
  ParagraphFormat,
  LineSpacingRule,
} from "../wordApi";
import { ContextManager } from "../contextManager";
import {
  OperationLogEntry,
  HeaderFooterTemplate,
  TypographyOptions,
} from "./types";

// ==================== 模块级状态 ====================

export const contextManager = new ContextManager(4000);

export const operationLogs: OperationLogEntry[] = [];

export const defaultTypographyOptions: TypographyOptions = {
  chineseFont: "宋体",
  englishFont: "Times New Roman",
  enforceSpacing: true,
  enforcePunctuation: true,
};

export const defaultHeaderFooterTemplate: HeaderFooterTemplate = {
  primaryHeader: "{documentName}",
  primaryFooter: "第 {pageNumber} 页",
  useDifferentFirstPage: false,
  useDifferentOddEven: false,
  includePageNumber: true,
  includeDate: false,
  includeDocumentName: true,
};

export const chineseRegex = /[\u4e00-\u9fff]/;
export const englishRegex = /[A-Za-z]/;

// ==================== 工具函数 ====================

export function uniqueSorted(indices: number[]): number[] {
  return Array.from(new Set(indices)).sort((a, b) => a - b);
}

export function filterParagraphsByIndices(
  paragraphs: ParagraphInfo[],
  indices: number[]
): ParagraphInfo[] {
  if (indices.length === 0) return [];
  const indexSet = new Set(indices);
  return paragraphs.filter((p) => indexSet.has(p.index));
}

export function getDominantParagraph(paragraphs: ParagraphInfo[]): ParagraphInfo | null {
  if (paragraphs.length === 0) return null;
  const counts = new Map<string, { count: number; sample: ParagraphInfo }>();
  for (const para of paragraphs) {
    const signature = JSON.stringify({
      name: para.font.name || "",
      size: para.font.size || 0,
      bold: para.font.bold ? 1 : 0,
      alignment: para.paragraph.alignment || "",
      firstLineIndent: Math.round((para.paragraph.firstLineIndent || 0) * 10) / 10,
      leftIndent: Math.round((para.paragraph.leftIndent || 0) * 10) / 10,
      lineSpacing: Math.round((para.paragraph.lineSpacing || 0) * 10) / 10,
      lineSpacingRule: para.paragraph.lineSpacingRule || "exactly",
      spaceBefore: Math.round((para.paragraph.spaceBefore || 0) * 10) / 10,
      spaceAfter: Math.round((para.paragraph.spaceAfter || 0) * 10) / 10,
    });
    const existing = counts.get(signature);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(signature, { count: 1, sample: para });
    }
  }
  let best: { count: number; sample: ParagraphInfo } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  return best?.sample ?? null;
}

export function stripHeadingNumber(text: string): string {
  return text.replace(/^\s*\d+(\.\d+)*\s+/, "").trim();
}

export function formatMismatch(
  para: ParagraphInfo,
  reference: ParagraphInfo
): boolean {
  const fontName = para.font.name || "";
  const refName = reference.font.name || "";
  const fontSize = para.font.size || 0;
  const refSize = reference.font.size || 0;
  const bold = para.font.bold ?? false;
  const refBold = reference.font.bold ?? false;
  const align = para.paragraph.alignment || "";
  const refAlign = reference.paragraph.alignment || "";
  const spaceBefore = para.paragraph.spaceBefore || 0;
  const refSpaceBefore = reference.paragraph.spaceBefore || 0;
  const spaceAfter = para.paragraph.spaceAfter || 0;
  const refSpaceAfter = reference.paragraph.spaceAfter || 0;
  const lineSpacing = para.paragraph.lineSpacing || 0;
  const refLineSpacing = reference.paragraph.lineSpacing || 0;
  const firstIndent = para.paragraph.firstLineIndent || 0;
  const refFirstIndent = reference.paragraph.firstLineIndent || 0;

  const numberDiff = (a: number, b: number) => Math.abs(a - b) > 0.5;

  return (
    fontName !== refName ||
    numberDiff(fontSize, refSize) ||
    bold !== refBold ||
    align !== refAlign ||
    numberDiff(spaceBefore, refSpaceBefore) ||
    numberDiff(spaceAfter, refSpaceAfter) ||
    numberDiff(lineSpacing, refLineSpacing) ||
    numberDiff(firstIndent, refFirstIndent)
  );
}

export function normalizeTypographyText(
  text: string,
  options: TypographyOptions
): { text: string; changed: boolean } {
  let updated = text;

  if (options.enforceSpacing) {
    updated = updated.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2");
    updated = updated.replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
    updated = updated.replace(/(\d)([A-Za-z])/g, "$1 $2");
    updated = updated.replace(/(\d)\s+([年年月日个项次度%℃])/g, "$1$2");
  }

  if (options.enforcePunctuation) {
    updated = updated.replace(/([，。？！；：、])\s+/g, "$1");
    updated = updated.replace(/\s+([,.!?;:])/g, "$1");
    updated = updated.replace(/([\u4e00-\u9fff])([,;:!?])/g, (_, cjk, p) => {
      const map: Record<string, string> = {
        ",": "，",
        ";": "；",
        ":": "：",
        "!": "！",
        "?": "？",
      };
      return cjk + (map[p] || p);
    });
  }

  return { text: updated, changed: updated !== text };
}

/**
 * 验证并标准化格式规范
 * - 保留并修正缩进
 * - 统一全文行距，避免不同段落类型的行距混乱
 * - 保留标题额外段距，正文/列表使用零段距，避免相邻段落间距互相影响
 */
export function sanitizeFormatSpec(formatSpec: FormatSpecification): FormatSpecification {
  const sanitized: FormatSpecification = {};

  const styleKeys: Array<keyof FormatSpecification> = [
    "heading1",
    "heading2",
    "heading3",
    "bodyText",
    "listItem",
  ];

  const normalizeLineSpacingRule = (
    value: unknown,
    lineSpacing: number | undefined
  ): LineSpacingRule => {
    if (value === "multiple" || value === "exactly" || value === "atLeast") {
      return value;
    }
    // Word 段落 lineSpacing > 6 通常是磅值（exactly/atLeast），否则按多倍行距处理。
    if (lineSpacing !== undefined && lineSpacing > 6) {
      return "exactly";
    }
    return "multiple";
  };

  const pickUnifiedLineSpacing = (
    spec: FormatSpecification
  ): {
    lineSpacing: number;
    lineSpacingRule: LineSpacingRule;
  } => {
    const paragraphs = [
      spec.bodyText?.paragraph,
      spec.listItem?.paragraph,
      spec.heading1?.paragraph,
      spec.heading2?.paragraph,
      spec.heading3?.paragraph,
    ].filter((paragraph): paragraph is ParagraphFormat => !!paragraph);

    let lineSpacing: number | undefined;
    let lineSpacingRule: LineSpacingRule | undefined;

    for (const paragraph of paragraphs) {
      if (
        lineSpacing === undefined
        && Number.isFinite(paragraph.lineSpacing)
        && (paragraph.lineSpacing || 0) > 0
      ) {
        lineSpacing = paragraph.lineSpacing;
        lineSpacingRule = normalizeLineSpacingRule(paragraph.lineSpacingRule, paragraph.lineSpacing);
        break;
      }
    }

    return {
      lineSpacing: lineSpacing ?? 1.5,
      lineSpacingRule: lineSpacingRule ?? "multiple",
    };
  };

  const normalizeNonNegativeNumber = (value: unknown): number | undefined => {
    if (!Number.isFinite(value)) return undefined;
    const nextValue = Number(value);
    if (nextValue < 0) return undefined;
    return nextValue;
  };

  const headingSpacingDefaults: Record<"heading1" | "heading2" | "heading3", { before: number; after: number }> = {
    heading1: { before: 16, after: 8 },
    heading2: { before: 12, after: 6 },
    heading3: { before: 6, after: 6 },
  };

  const sanitizeParagraphFormat = (
    format: { font: FontFormat; paragraph: ParagraphFormat } | undefined,
    isHeading: boolean
  ): { font: FontFormat; paragraph: ParagraphFormat } | undefined => {
    if (!format) return undefined;

    const paragraph = { ...format.paragraph };

    // 缩进处理
    if (isHeading) {
      // 标题不应有缩进
      paragraph.firstLineIndent = 0;
      paragraph.leftIndent = 0;
    } else {
      // 限制首行缩进在合理范围内（0-2字符）
      if (paragraph.firstLineIndent !== undefined) {
        paragraph.firstLineIndent = Math.max(0, Math.min(paragraph.firstLineIndent, 2));
      }
      // 限制左缩进在合理范围内（0-2字符）
      if (paragraph.leftIndent !== undefined) {
        paragraph.leftIndent = Math.max(0, Math.min(paragraph.leftIndent, 2));
      }
    }

    // 行距与段间距在后续统一处理，避免相邻段落出现“互相影响”的视觉差异。

    return {
      font: format.font,
      paragraph,
    };
  };

  sanitized.heading1 = sanitizeParagraphFormat(formatSpec.heading1, true);
  sanitized.heading2 = sanitizeParagraphFormat(formatSpec.heading2, true);
  sanitized.heading3 = sanitizeParagraphFormat(formatSpec.heading3, true);
  sanitized.bodyText = sanitizeParagraphFormat(formatSpec.bodyText, false);
  sanitized.listItem = sanitizeParagraphFormat(formatSpec.listItem, false);

  const unifiedLineSpacing = pickUnifiedLineSpacing(sanitized);
  for (const key of styleKeys) {
    const target = sanitized[key];
    if (!target) continue;
    target.paragraph.lineSpacing = unifiedLineSpacing.lineSpacing;
    target.paragraph.lineSpacingRule = unifiedLineSpacing.lineSpacingRule;

    // 段间距策略：
    // 1) 标题保留“额外段距”（优先保留 AI 值，缺失时回退到推荐默认值）
    // 2) 正文/列表固定为 0，避免相邻段落的段前/段后叠加造成视觉不一致
    if (key === "heading1" || key === "heading2" || key === "heading3") {
      const defaults = headingSpacingDefaults[key];
      const currentBefore = normalizeNonNegativeNumber(target.paragraph.spaceBefore);
      const currentAfter = normalizeNonNegativeNumber(target.paragraph.spaceAfter);
      target.paragraph.spaceBefore = currentBefore ?? defaults.before;
      target.paragraph.spaceAfter = currentAfter ?? defaults.after;
    } else {
      target.paragraph.spaceBefore = 0;
      target.paragraph.spaceAfter = 0;
    }
  }

  return sanitized;
}

export function findCaptionParagraphs(paragraphs: ParagraphInfo[]): ParagraphInfo[] {
  const captionPattern = /^(图|表|图表|Figure|Table)\s*([0-9]+)?[\.：:]/i;
  return paragraphs.filter((p) => captionPattern.test(p.text.trim()));
}

export function makeChangeItem(
  id: string,
  title: string,
  description: string,
  type: import("./types").ChangeType,
  paragraphIndices: number[],
  data?: Record<string, unknown>,
  requiresContentChange: boolean = false
): import("./types").ChangeItem {
  return {
    id,
    title,
    description,
    type,
    paragraphIndices,
    data,
    requiresContentChange,
  };
}
