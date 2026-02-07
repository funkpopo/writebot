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
  paragraphType: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem",
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

    const validIndices = paragraphIndices.filter(
      (index) => index >= 0 && index < paragraphs.items.length
    );
    for (const index of validIndices) {
      paragraphs.items[index].load("font/size");
    }
    await context.sync();

    const originalFontSizes: Map<number, number> = new Map();
    for (const index of validIndices) {
      const para = paragraphs.items[index];
      originalFontSizes.set(index, para.font.size || 12);
    }

    for (const index of validIndices) {
      const para = paragraphs.items[index];

      try {
        const requestedFontSize = normalizeNumber(format.font.size);
        const fontSizeForIndent = requestedFontSize || originalFontSizes.get(index) || 12;

        const fontName = normalizeString(format.font.name);
        if (fontName) para.font.name = fontName;
        if (requestedFontSize && requestedFontSize > 0) para.font.size = requestedFontSize;
        const fontBold = normalizeBoolean(format.font.bold);
        if (fontBold !== undefined) para.font.bold = fontBold;
        const fontItalic = normalizeBoolean(format.font.italic);
        if (fontItalic !== undefined) para.font.italic = fontItalic;
        const fontColor = normalizeColorValue(format.font.color);
        if (fontColor) para.font.color = fontColor;

        const alignment = normalizeString(format.paragraph.alignment);
        if (alignment) {
          const wordAlignment = toWordAlignment(alignment);
          if (wordAlignment) {
            para.alignment = wordAlignment;
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
            para.lineSpacing = actualLineSpacing;
          }
        }

        const isHeading = paragraphType === "heading1" || paragraphType === "heading2" || paragraphType === "heading3";

        if (isHeading) {
          para.firstLineIndent = 0;
          para.leftIndent = 0;
        } else {
          const firstLineIndent = normalizeNumber(format.paragraph.firstLineIndent);
          if (firstLineIndent !== undefined) {
            const indentChars = firstLineIndent;
            const clampedIndentChars = Math.max(0, Math.min(indentChars, 2));
            const indentPoints = calculateIndentInPoints(clampedIndentChars, fontSizeForIndent);
            if (Number.isFinite(indentPoints)) {
              para.firstLineIndent = indentPoints;
            }
          }
          const leftIndent = normalizeNumber(format.paragraph.leftIndent);
          if (leftIndent !== undefined) {
            const indentChars = leftIndent;
            const clampedIndentChars = Math.max(0, Math.min(indentChars, 2));
            const indentPoints = calculateIndentInPoints(clampedIndentChars, fontSizeForIndent);
            if (Number.isFinite(indentPoints)) {
              para.leftIndent = indentPoints;
            }
          }
        }

        const spaceBefore = normalizeNumber(format.paragraph.spaceBefore);
        if (spaceBefore !== undefined && spaceBefore >= 0) {
          para.spaceBefore = spaceBefore;
        }
        const spaceAfter = normalizeNumber(format.paragraph.spaceAfter);
        if (spaceAfter !== undefined && spaceAfter >= 0) {
          para.spaceAfter = spaceAfter;
        }
      } catch (err) {
        console.warn(`格式应用失败 (段落 ${index}):`, err);
      }
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
    type: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem";
  }>,
  batchSize: number = 20,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const total = paragraphsToFormat.length;
  if (total === 0) return;

  const beforeCheckpoint = await createContentCheckpoint();

  for (let i = 0; i < total; i += batchSize) {
    const batch = paragraphsToFormat.slice(i, i + batchSize);

    const byType: Record<string, number[]> = {};
    for (const item of batch) {
      if (!byType[item.type]) {
        byType[item.type] = [];
      }
      byType[item.type].push(item.index);
    }

    for (const [type, indices] of Object.entries(byType)) {
      await applyFormatToParagraphsSafe(
        formatSpec,
        indices,
        type as "heading1" | "heading2" | "heading3" | "bodyText" | "listItem",
        { skipContentCheck: true }
      );
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }
  }

  const afterCheckpoint = await createContentCheckpoint();
  const result = verifyContentIntegrity(beforeCheckpoint, afterCheckpoint);

  if (!result.valid) {
    throw new Error(`内容完整性校验失败: ${result.error}`);
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
  const batchSize = 20;

  for (let i = 0; i < total; i += batchSize) {
    const batch = corrections.slice(i, i + batchSize);

    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();

      for (const correction of batch) {
        if (correction.paragraphIndex >= paragraphs.items.length) continue;

        const para = paragraphs.items[correction.paragraphIndex];
        const normalizedColor = normalizeColorValue(correction.suggestedColor);
        if (!normalizedColor) continue;
        para.font.color = normalizedColor;
      }

      await context.sync();
    });

    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }
  }
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
