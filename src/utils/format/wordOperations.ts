/**
 * AI排版服务 - Word文档操作
 * 底层Word.run操作函数，供appliers.ts调用
 */

import {
  getDocumentName,
} from "../wordApi";
import {
  HeaderFooterTemplate,
  TypographyFontApplicationMode,
  TypographyOptions,
} from "./types";
import { normalizeTypographyText } from "./utils";

interface TypographyWildcardRule {
  id: string;
  searchPattern: string;
  shouldApply: (text: string) => boolean;
  replaceFn: (text: string) => string;
}

export interface TypographyWildcardRulePlan {
  id: string;
  searchPattern: string;
}

const DEFAULT_FONT_APPLICATION_MODE: TypographyFontApplicationMode = "defaultText";
const SENSITIVE_TYPOGRAPHY_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/,
  /`[^`]+`/,
  /\bhttps?:\/\/[^\s]+/i,
  /\bwww\.[^\s]+/i,
  /\[[^\]]+\]\([^)]+\)/,
  /\{\s*(?:PAGE|NUMPAGES|DATE|TIME|REF|SEQ|TOC|HYPERLINK)\b[^}]*\}/i,
];

export function hasSensitiveTypographyContent(text: string): boolean {
  if (!text) {
    return false;
  }
  return SENSITIVE_TYPOGRAPHY_PATTERNS.some((pattern) => pattern.test(text));
}

function getTypographyWildcardRules(options: TypographyOptions): TypographyWildcardRule[] {
  const rules: TypographyWildcardRule[] = [];

  if (options.enforceSpacing) {
    rules.push(
      {
        id: "cjk-latin-spacing",
        searchPattern: "[一-龥][A-Za-z0-9]",
        shouldApply: (text) => /[\u4e00-\u9fff][A-Za-z0-9]/.test(text),
        replaceFn: (text) => {
          const first = text.charAt(0);
          const rest = text.slice(1);
          return rest.startsWith(" ") ? text : `${first} ${rest}`;
        },
      },
      {
        id: "latin-cjk-spacing",
        searchPattern: "[A-Za-z0-9][一-龥]",
        shouldApply: (text) => /[A-Za-z0-9][\u4e00-\u9fff]/.test(text),
        replaceFn: (text) => {
          const first = text.charAt(0);
          const rest = text.slice(1);
          return rest.startsWith(" ") ? text : `${first} ${rest}`;
        },
      },
      {
        id: "digit-latin-spacing",
        searchPattern: "[0-9][A-Za-z]",
        shouldApply: (text) => /[0-9][A-Za-z]/.test(text),
        replaceFn: (text) => {
          const first = text.charAt(0);
          const rest = text.slice(1);
          return rest.startsWith(" ") ? text : `${first} ${rest}`;
        },
      },
      {
        id: "digit-unit-compact",
        searchPattern: "[0-9][ ]@[年年月日个项次度%℃]",
        shouldApply: (text) => /[0-9]\s+[年年月日个项次度%℃]/.test(text),
        replaceFn: (text) => text.replace(/\s+/g, ""),
      }
    );
  }

  if (options.enforcePunctuation) {
    rules.push(
      {
        id: "cjk-punctuation-no-tail-space",
        searchPattern: "[，。？！；：、][ ]@",
        shouldApply: (text) => /[，。？！；：、]\s+/.test(text),
        replaceFn: (text) => text.charAt(0),
      },
      {
        id: "en-punctuation-no-leading-space",
        searchPattern: "[ ]@[,\\.!?;:]",
        shouldApply: (text) => /\s+[,.!?;:]/.test(text),
        replaceFn: (text) => text.trimStart(),
      },
      {
        id: "cjk-en-punctuation-map",
        searchPattern: "[一-龥][,;:!?]",
        shouldApply: (text) => /[\u4e00-\u9fff][,;:!?]/.test(text),
        replaceFn: (text) => {
          const cjk = text.charAt(0);
          const punc = text.charAt(1);
          const map: Record<string, string> = {
            ",": "，",
            ";": "；",
            ":": "：",
            "!": "！",
            "?": "？",
          };
          return cjk + (map[punc] || punc);
        },
      }
    );
  }

  return rules;
}

function buildTypographyRulePlanFromRules(
  text: string,
  rules: TypographyWildcardRule[]
): TypographyWildcardRulePlan[] {
  return rules
    .filter((rule) => rule.shouldApply(text))
    .map((rule) => ({ id: rule.id, searchPattern: rule.searchPattern }));
}

export function buildTypographyWildcardRulePlan(
  text: string,
  options: TypographyOptions
): TypographyWildcardRulePlan[] {
  return buildTypographyRulePlanFromRules(text, getTypographyWildcardRules(options));
}

async function applyTypographyWildcardRules(
  context: Word.RequestContext,
  paragraph: Word.Paragraph,
  rules: TypographyWildcardRule[]
): Promise<void> {
  if (rules.length === 0) {
    return;
  }

  const range = paragraph.getRange();
  const resultsByRule = rules.map((rule) => {
    const results = range.search(rule.searchPattern, {
      matchWildcards: true,
      matchCase: true,
    });
    results.load("items");
    return { rule, results };
  });

  await context.sync();

  const activeResults = resultsByRule.filter((entry) => entry.results.items.length > 0);
  if (activeResults.length === 0) {
    return;
  }

  for (const entry of activeResults) {
    for (const item of entry.results.items) {
      item.load("text");
    }
  }

  await context.sync();

  let hasChanges = false;
  for (const entry of activeResults) {
    for (let i = entry.results.items.length - 1; i >= 0; i--) {
      const item = entry.results.items[i];
      const original = item.text || "";
      const updated = entry.rule.replaceFn(original);
      if (updated !== original) {
        item.insertText(updated, Word.InsertLocation.replace);
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    await context.sync();
  }
}

async function applyFontMappingToDefaultText(
  context: Word.RequestContext,
  paragraph: Word.Paragraph,
  chineseFont: string,
  englishFont: string
): Promise<void> {
  const range = paragraph.getRange();
  const cjkRanges = range.search("[一-龥]@", { matchWildcards: true, matchCase: true });
  const latinRanges = range.search("[A-Za-z0-9]@", { matchWildcards: true, matchCase: true });
  cjkRanges.load("items");
  latinRanges.load("items");
  await context.sync();

  if (cjkRanges.items.length === 0 && latinRanges.items.length === 0) {
    return;
  }

  for (const item of cjkRanges.items) {
    const fontAny = item.font as unknown as { name?: string; nameEastAsia?: string };
    fontAny.name = chineseFont;
    fontAny.nameEastAsia = chineseFont;
  }
  for (const item of latinRanges.items) {
    const fontAny = item.font as unknown as { nameAscii?: string };
    fontAny.nameAscii = englishFont;
  }

  await context.sync();
}

export async function applyHeadingLevelFix(
  changes: Array<{ index: number; level: number }>
): Promise<void> {
  if (changes.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const change of changes) {
      if (change.index < 0 || change.index >= paragraphs.items.length) continue;
      const para = paragraphs.items[change.index];
      const headingName = `Heading ${change.level}`;
      try {
        para.style = headingName;
      } catch {
        para.style = `标题 ${change.level}`;
      }
    }

    await context.sync();
  });
}

export async function applyHeadingNumbering(
  numberingMap: Array<{ index: number; newText: string }>
): Promise<void> {
  if (numberingMap.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const change of numberingMap) {
      if (change.index < 0 || change.index >= paragraphs.items.length) continue;
      const para = paragraphs.items[change.index];
      para.insertText(change.newText, Word.InsertLocation.replace);
    }

    await context.sync();
  });
}

export async function applyTableFormatting(): Promise<void> {
  await Word.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load("items");
    await context.sync();

    const allRows: Word.TableRowCollection[] = [];
    for (const table of tables.items) {
      table.style = "Table Grid";
      const rows = table.rows;
      rows.load("items");
      allRows.push(rows);
    }
    await context.sync();

    for (const rows of allRows) {
      if (rows.items.length > 0) {
        const headerRow = rows.items[0];
        headerRow.font.bold = true;
        (headerRow as unknown as { shadingColor?: string }).shadingColor = "#F2F2F2";
        (headerRow as unknown as { height?: number }).height = 18;
      }
    }
    await context.sync();
  });
}

export async function applyCaptionFormatting(
  captionFixMap: Array<{ index: number; newText: string }>
): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const item of captionFixMap) {
      if (item.index < 0 || item.index >= paragraphs.items.length) continue;
      const para = paragraphs.items[item.index];
      para.insertText(item.newText, Word.InsertLocation.replace);
      para.alignment = Word.Alignment.centered;
      para.font.bold = false;
      para.font.size = 10.5;
    }

    await context.sync();
  });
}

export async function applyImageAlignment(): Promise<void> {
  await Word.run(async (context) => {
    const pics = context.document.body.inlinePictures;
    pics.load("items");
    await context.sync();

    const allParagraphs: Word.ParagraphCollection[] = [];
    for (const pic of pics.items) {
      const range = pic.getRange();
      const paragraphs = range.paragraphs;
      paragraphs.load("items");
      allParagraphs.push(paragraphs);
    }
    await context.sync();

    for (const paragraphs of allParagraphs) {
      for (const para of paragraphs.items) {
        para.alignment = Word.Alignment.centered;
        para.spaceBefore = 6;
        para.spaceAfter = 6;
      }
    }
    await context.sync();
  });
}

export async function updateTableOfContents(): Promise<void> {
  return Word.run(async (context) => {
    const docAny = context.document as unknown as { tablesOfContents?: unknown };
    const tocs = docAny.tablesOfContents as
      | { items: Array<{ update: () => void }>; load: (prop: string) => void }
      | undefined;

    if (tocs) {
      tocs.load("items");
      await context.sync();
      if (tocs.items.length > 0) {
        for (const toc of tocs.items) {
          toc.update();
        }
        await context.sync();
        return;
      }
    }

    const bodyAny = context.document.body as unknown as {
      insertTableOfContents?: (...args: unknown[]) => void;
    };

    if (typeof bodyAny.insertTableOfContents === "function") {
      bodyAny.insertTableOfContents(
        Word.InsertLocation.start,
        "TOC1",
        true,
        true,
        true,
        "Dots"
      );
      await context.sync();
    }
  });
}

export async function applyHeaderFooterTemplate(
  template: HeaderFooterTemplate
): Promise<void> {
  const documentName = await getDocumentName();
  const today = new Date().toLocaleDateString();

  await Word.run(async (context) => {
    const sections = context.document.sections;
    sections.load("items");
    await context.sync();

    for (const section of sections.items) {
      const pageSetup = section.pageSetup as unknown as {
        differentFirstPageHeaderFooter?: boolean;
        oddAndEvenPagesHeaderFooter?: boolean;
      };
      pageSetup.differentFirstPageHeaderFooter = !!template.useDifferentFirstPage;
      pageSetup.oddAndEvenPagesHeaderFooter = !!template.useDifferentOddEven;

      const insertContent = (target: Word.Body, text: string | undefined) => {
        target.clear();
        let finalText = text || "";
        if (template.includeDocumentName && !finalText.includes("{documentName}")) {
          finalText = `{documentName} ${finalText}`.trim();
        }
        if (template.includeDate && !finalText.includes("{date}")) {
          finalText = `${finalText} {date}`.trim();
        }
        if (template.includePageNumber) {
          if (!finalText.includes("{pageNumber}")) {
            finalText = `${finalText} {pageNumber}`.trim();
          }
        } else {
          finalText = finalText.replace(/\{pageNumber\}/g, "");
        }
        finalText = finalText.replace(/\s{2,}/g, " ").trim();
        finalText = finalText
          .replace(/\{documentName\}/g, documentName)
          .replace(/\{date\}/g, today);

        if (finalText.includes("{pageNumber}")) {
          const parts = finalText.split(/(\{pageNumber\})/g);
          for (const part of parts) {
            if (!part) continue;
            if (part === "{pageNumber}") {
              try {
                const range = target.getRange(Word.RangeLocation.end);
                (range as unknown as { insertField?: (loc: Word.InsertLocation, type: Word.FieldType) => Word.Field })
                  .insertField?.(Word.InsertLocation.end, Word.FieldType.page);
              } catch {
                target.insertText("{pageNumber}", Word.InsertLocation.end);
              }
            } else {
              target.insertText(part, Word.InsertLocation.end);
            }
          }
        } else {
          if (finalText) {
            target.insertText(finalText, Word.InsertLocation.start);
          }
        }
      };

      const header = section.getHeader(Word.HeaderFooterType.primary);
      insertContent(header, template.primaryHeader);
      const footer = section.getFooter(Word.HeaderFooterType.primary);
      insertContent(footer, template.primaryFooter);

      if (template.useDifferentFirstPage) {
        const firstHeader = section.getHeader(Word.HeaderFooterType.firstPage);
        const firstFooter = section.getFooter(Word.HeaderFooterType.firstPage);
        insertContent(firstHeader, template.firstPageHeader ?? template.primaryHeader);
        insertContent(firstFooter, template.firstPageFooter ?? template.primaryFooter);
      }

      if (template.useDifferentOddEven) {
        const evenHeader = section.getHeader(Word.HeaderFooterType.evenPages);
        const evenFooter = section.getFooter(Word.HeaderFooterType.evenPages);
        insertContent(evenHeader, template.evenPageHeader ?? template.primaryHeader);
        insertContent(evenFooter, template.evenPageFooter ?? template.primaryFooter);
      }
    }

    await context.sync();
  });
}

export async function applyTypographyNormalization(
  paragraphIndices: number[],
  options: TypographyOptions
): Promise<void> {
  if (paragraphIndices.length === 0) return;
  const applyFontMapping = options.applyFontMapping === true;
  const fontApplicationMode = options.fontApplicationMode || DEFAULT_FONT_APPLICATION_MODE;
  const skipSensitiveContent = options.skipSensitiveContent !== false;

  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const uniqueIndices = Array.from(new Set(paragraphIndices))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < paragraphs.items.length)
      .sort((a, b) => a - b);

    for (const index of uniqueIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].load("text");
    }
    await context.sync();

    const allRules = getTypographyWildcardRules(options);

    for (const index of uniqueIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const originalText = para.text || "";

      if (skipSensitiveContent && hasSensitiveTypographyContent(originalText)) {
        continue;
      }

      const result = normalizeTypographyText(originalText, options);

      if (result.changed) {
        const selectedRules = allRules.filter((rule) => rule.shouldApply(originalText));
        await applyTypographyWildcardRules(
          context,
          para,
          selectedRules.length > 0 ? selectedRules : allRules
        );
      }

      if (!applyFontMapping) {
        continue;
      }

      if (fontApplicationMode === "paragraph") {
        const fontAny = para.font as unknown as { name?: string; nameAscii?: string; nameEastAsia?: string };
        fontAny.name = options.chineseFont;
        fontAny.nameAscii = options.englishFont;
        fontAny.nameEastAsia = options.chineseFont;
      } else {
        await applyFontMappingToDefaultText(
          context,
          para,
          options.chineseFont,
          options.englishFont
        );
      }
    }

    await context.sync();
  });
}

export async function removeUnderline(paragraphIndices: number[]): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();
    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].font.underline = Word.UnderlineType.none;
    }
    await context.sync();
  });
}

export async function removeItalic(paragraphIndices: number[]): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();
    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].font.italic = false;
    }
    await context.sync();
  });
}

export async function removeStrikethrough(paragraphIndices: number[]): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();
    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].font.strikeThrough = false;
    }
    await context.sync();
  });
}

export async function applyPaginationControl(
  paragraphIndices: number[]
): Promise<{ deletedIndices: number[] }> {
  if (paragraphIndices.length === 0) {
    return { deletedIndices: [] };
  }

  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const uniqueIndices = Array.from(new Set(paragraphIndices))
      .filter((index) => index >= 0 && index < paragraphs.items.length)
      .sort((a, b) => a - b);

    for (const index of uniqueIndices) {
      paragraphs.items[index].load("text, style, pageBreakBefore");
    }
    await context.sync();

    const deletedIndices: number[] = [];
    for (const index of uniqueIndices) {
      const para = paragraphs.items[index];
      const text = para.text || "";
      if (text.trim() === "") {
        if (index > 0) {
          deletedIndices.push(index);
        }
        continue;
      }
      const styleName = para.style?.toString() || "";
      const normalizedStyle = styleName.toLowerCase();
      const isHeading = normalizedStyle.includes("heading") || styleName.includes("标题");
      if (isHeading) {
        (para as unknown as { keepWithNext?: boolean }).keepWithNext = true;
        (para as unknown as { keepTogether?: boolean }).keepTogether = true;
      }
      (para as unknown as { widowControl?: boolean }).widowControl = true;
      if ((para as unknown as { pageBreakBefore?: boolean }).pageBreakBefore) {
        (para as unknown as { pageBreakBefore?: boolean }).pageBreakBefore = false;
      }
    }

    const sortedDeleted = deletedIndices.sort((a, b) => b - a);
    for (const index of sortedDeleted) {
      if (index < 0 || index >= paragraphs.items.length) {
        continue;
      }
      paragraphs.items[index].delete();
    }

    await context.sync();
    return { deletedIndices: deletedIndices.sort((a, b) => a - b) };
  });
}

export async function applySpecialContentFormatting(
  paragraphIndices: number[]
): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].load("text");
    }
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const text = para.text || "";
      if (/```/.test(text) || /`[^`]+`/.test(text)) {
        para.font.name = "Consolas";
        para.font.size = 10;
        para.spaceBefore = 6;
        para.spaceAfter = 6;
      }
      if (/^>/.test(text)) {
        para.leftIndent = 12;
        para.font.italic = true;
        para.spaceBefore = 6;
        para.spaceAfter = 6;
      }
    }

    await context.sync();
  });
}
