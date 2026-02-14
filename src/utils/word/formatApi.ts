/* global Word */

import {
  FormatSpecification,
  ColorCorrectionItem,
} from "./types";
import {
  normalizeBoolean,
  normalizeNumber,
  normalizeString,
  normalizeColorValue,
  normalizeLineSpacingRule,
  resolveLineSpacingPoints,
  calculateIndentInPoints,
  toWordAlignment,
  getDefaultFontList,
} from "./utils";
import { createContentCheckpoint, verifyContentIntegrity } from "./contentCheckpoint";

type ParagraphType = "heading1" | "heading2" | "heading3" | "bodyText" | "listItem";
type ParagraphStyleFormat = NonNullable<FormatSpecification[ParagraphType]>;

const HEADING_PARAGRAPH_TYPE_SET = new Set<ParagraphType>(["heading1", "heading2", "heading3"]);

function collectValidParagraphIndices(indices: number[], paragraphCount: number): number[] {
  return Array.from(
    new Set(
      indices.filter((index) => Number.isInteger(index) && index >= 0 && index < paragraphCount)
    )
  );
}

function groupIndicesByType(
  targets: Array<{ index: number; type: ParagraphType }>,
  paragraphCount: number
): Map<ParagraphType, number[]> {
  const grouped = new Map<ParagraphType, number[]>();
  for (const target of targets) {
    if (!Number.isInteger(target.index) || target.index < 0 || target.index >= paragraphCount) {
      continue;
    }
    const current = grouped.get(target.type) || [];
    current.push(target.index);
    grouped.set(target.type, current);
  }
  for (const [type, indices] of grouped.entries()) {
    grouped.set(type, collectValidParagraphIndices(indices, paragraphCount));
  }
  return grouped;
}

async function loadOriginalFontSizes(
  context: Word.RequestContext,
  paragraphs: Word.ParagraphCollection,
  indices: number[]
): Promise<Map<number, number>> {
  const validIndices = collectValidParagraphIndices(indices, paragraphs.items.length);
  if (validIndices.length === 0) {
    return new Map();
  }

  for (const index of validIndices) {
    paragraphs.items[index].load("font/size");
  }
  await context.sync();

  const originalFontSizes = new Map<number, number>();
  for (const index of validIndices) {
    originalFontSizes.set(index, paragraphs.items[index].font.size || 12);
  }
  return originalFontSizes;
}

function applyParagraphStyleFormat(
  paragraph: Word.Paragraph,
  paragraphType: ParagraphType,
  format: ParagraphStyleFormat,
  originalFontSize: number,
  index: number
): void {
  try {
    const requestedFontSize = normalizeNumber(format.font.size);
    const fontSizeForIndent = requestedFontSize || originalFontSize || 12;

    const fontName = normalizeString(format.font.name);
    if (fontName) paragraph.font.name = fontName;
    if (requestedFontSize && requestedFontSize > 0) paragraph.font.size = requestedFontSize;
    const fontBold = normalizeBoolean(format.font.bold);
    if (fontBold !== undefined) paragraph.font.bold = fontBold;
    const fontItalic = normalizeBoolean(format.font.italic);
    if (fontItalic !== undefined) paragraph.font.italic = fontItalic;
    const fontColor = normalizeColorValue(format.font.color);
    if (fontColor) paragraph.font.color = fontColor;

    const alignment = normalizeString(format.paragraph.alignment);
    if (alignment) {
      const wordAlignment = toWordAlignment(alignment);
      if (wordAlignment) {
        paragraph.alignment = wordAlignment;
      }
    }

    const lineSpacing = normalizeNumber(format.paragraph.lineSpacing);
    if (lineSpacing !== undefined && lineSpacing > 0) {
      const lineSpacingRule = normalizeLineSpacingRule(format.paragraph.lineSpacingRule);
      const actualLineSpacing = resolveLineSpacingPoints(
        lineSpacing,
        lineSpacingRule,
        fontSizeForIndent
      );
      if (actualLineSpacing !== undefined && actualLineSpacing <= 1000) {
        paragraph.lineSpacing = actualLineSpacing;
      }
    }

    if (HEADING_PARAGRAPH_TYPE_SET.has(paragraphType)) {
      paragraph.firstLineIndent = 0;
      paragraph.leftIndent = 0;
    } else {
      const firstLineIndent = normalizeNumber(format.paragraph.firstLineIndent);
      if (firstLineIndent !== undefined) {
        const clampedIndentChars = Math.max(0, Math.min(firstLineIndent, 2));
        const indentPoints = calculateIndentInPoints(clampedIndentChars, fontSizeForIndent);
        if (Number.isFinite(indentPoints)) {
          paragraph.firstLineIndent = indentPoints;
        }
      }
      const leftIndent = normalizeNumber(format.paragraph.leftIndent);
      if (leftIndent !== undefined) {
        const clampedIndentChars = Math.max(0, Math.min(leftIndent, 2));
        const indentPoints = calculateIndentInPoints(clampedIndentChars, fontSizeForIndent);
        if (Number.isFinite(indentPoints)) {
          paragraph.leftIndent = indentPoints;
        }
      }
    }

    const spaceBefore = normalizeNumber(format.paragraph.spaceBefore);
    if (spaceBefore !== undefined && spaceBefore >= 0) {
      paragraph.spaceBefore = spaceBefore;
    }
    const spaceAfter = normalizeNumber(format.paragraph.spaceAfter);
    if (spaceAfter !== undefined && spaceAfter >= 0) {
      paragraph.spaceAfter = spaceAfter;
    }
  } catch (err) {
    console.warn(`格式应用失败 (段落 ${index}):`, err);
  }
}

/**
 * 设置选中文本为粗体
 */
export async function setBold(): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.font.bold = true;
    await context.sync();
  });
}

/**
 * 设置选中文本为斜体
 */
export async function setItalic(): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.font.italic = true;
    await context.sync();
  });
}

/**
 * 添加批注到选中文本
 */
export async function addComment(commentText: string): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertComment(commentText);
    await context.sync();
  });
}

/**
 * 应用格式到当前选区
 */
export async function applyFormatToSelection(format: {
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontName?: string;
  color?: string;
}): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const font = selection.font;

    const bold = normalizeBoolean(format.bold);
    if (bold !== undefined) font.bold = bold;

    const italic = normalizeBoolean(format.italic);
    if (italic !== undefined) font.italic = italic;

    const fontSize = normalizeNumber(format.fontSize);
    if (fontSize !== undefined && fontSize > 0) font.size = fontSize;

    const fontName = normalizeString(format.fontName);
    if (fontName) font.name = fontName;

    const color = normalizeColorValue(format.color);
    if (color) font.color = color;

    await context.sync();
  });
}

/**
 * 安全的格式应用 - 只修改格式属性，不修改内容
 */
export async function applyFormatToParagraphsSafe(
  formatSpec: FormatSpecification,
  paragraphIndices: number[],
  paragraphType: ParagraphType,
  options?: { skipContentCheck?: boolean }
): Promise<void> {
  const shouldCheck = !options?.skipContentCheck;
  const beforeCheckpoint = shouldCheck ? await createContentCheckpoint() : null;

  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const format = formatSpec[paragraphType];
    if (!format) return;

    const validIndices = collectValidParagraphIndices(paragraphIndices, paragraphs.items.length);
    const originalFontSizes = await loadOriginalFontSizes(context, paragraphs, validIndices);

    for (const index of validIndices) {
      const paragraph = paragraphs.items[index];
      const originalFontSize = originalFontSizes.get(index) || 12;
      applyParagraphStyleFormat(paragraph, paragraphType, format, originalFontSize, index);
    }

    await context.sync();
  });

  if (shouldCheck && beforeCheckpoint) {
    const afterCheckpoint = await createContentCheckpoint();
    const result = verifyContentIntegrity(beforeCheckpoint, afterCheckpoint);

    if (!result.valid) {
      throw new Error(`内容完整性校验失败: ${result.error}`);
    }
  }
}

/**
 * 批量应用格式到指定段落（带进度回调）
 */
export async function applyFormatToParagraphsBatch(
  formatSpec: FormatSpecification,
  paragraphsToFormat: Array<{
    index: number;
    type: ParagraphType;
  }>,
  batchSize: number = 20,
  onProgress?: (current: number, total: number) => void,
  options?: { skipContentCheck?: boolean }
): Promise<void> {
  const total = paragraphsToFormat.length;
  if (total === 0) return;

  const shouldCheck = !options?.skipContentCheck;
  const beforeCheckpoint = shouldCheck ? await createContentCheckpoint() : null;
  const effectiveBatchSize = Math.max(1, batchSize);

  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const allIndices = paragraphsToFormat.map((item) => item.index);
    const validIndices = collectValidParagraphIndices(allIndices, paragraphs.items.length);
    const originalFontSizes = await loadOriginalFontSizes(context, paragraphs, validIndices);

    for (let i = 0; i < total; i += effectiveBatchSize) {
      const batch = paragraphsToFormat.slice(i, i + effectiveBatchSize);
      const grouped = groupIndicesByType(batch, paragraphs.items.length);

      for (const [paragraphType, indices] of grouped.entries()) {
        const format = formatSpec[paragraphType];
        if (!format) continue;

        for (const index of indices) {
          const paragraph = paragraphs.items[index];
          const originalFontSize = originalFontSizes.get(index) || 12;
          applyParagraphStyleFormat(paragraph, paragraphType, format, originalFontSize, index);
        }
      }

      await context.sync();
      onProgress?.(Math.min(i + effectiveBatchSize, total), total);
    }
  });

  if (shouldCheck && beforeCheckpoint) {
    const afterCheckpoint = await createContentCheckpoint();
    const result = verifyContentIntegrity(beforeCheckpoint, afterCheckpoint);

    if (!result.valid) {
      throw new Error(`内容完整性校验失败: ${result.error}`);
    }
  }
}

/**
 * 批量应用颜色修正到指定段落
 */
export async function applyColorCorrections(
  corrections: ColorCorrectionItem[],
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const total = corrections.length;
  if (total === 0) return;

  const batchSize = 50;

  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (let i = 0; i < total; i += batchSize) {
      const batch = corrections.slice(i, i + batchSize);
      for (const correction of batch) {
        if (correction.paragraphIndex < 0 || correction.paragraphIndex >= paragraphs.items.length) {
          continue;
        }
        const normalizedColor = normalizeColorValue(correction.suggestedColor);
        if (!normalizedColor) continue;
        paragraphs.items[correction.paragraphIndex].font.color = normalizedColor;
      }
      await context.sync();
      onProgress?.(Math.min(i + batchSize, total), total);
    }
  });
}

/**
 * 获取Word中所有可用的字体列表
 * 注意：此API需要WordApiDesktop 1.4，仅在桌面版Word中可用
 */
export async function getAvailableFonts(): Promise<string[]> {
  try {
    return await Word.run(async (context) => {
      const app = context.application;
      const fontNames = app.fontNames;
      const count = fontNames.getCount();
      await context.sync();

      const fonts: string[] = [];
      const totalCount = count.value;

      const fontResults: OfficeExtension.ClientResult<string>[] = [];
      for (let i = 0; i < totalCount; i++) {
        fontResults.push(fontNames.getItemAt(i));
      }
      await context.sync();

      for (const result of fontResults) {
        fonts.push(result.value);
      }

      return fonts;
    });
  } catch {
    return getDefaultFontList();
  }
}
