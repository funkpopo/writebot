/**
 * AI排版服务 - Word文档操作
 * 底层Word.run操作函数，供appliers.ts调用
 */

import {
  getDocumentName,
} from "../wordApi";
import {
  HeaderFooterTemplate,
  TypographyOptions,
} from "./types";
import { normalizeTypographyText } from "./utils";

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

    for (const table of tables.items) {
      table.style = "Table Grid";
      const rows = table.rows;
      rows.load("items");
      await context.sync();

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

    for (const pic of pics.items) {
      const range = pic.getRange();
      const paragraphs = range.paragraphs;
      paragraphs.load("items");
      await context.sync();
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
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].load("text");
    }
    await context.sync();

    const replaceByWildcard = async (
      paragraph: Word.Paragraph,
      searchPattern: string,
      replaceFn: (text: string) => string
    ) => {
      const range = paragraph.getRange();
      const results = range.search(searchPattern, { matchWildcards: true, matchCase: true });
      results.load("items");
      await context.sync();
      if (!results.items.length) return;
      for (const item of results.items) { item.load("text"); }
      await context.sync();
      for (let i = results.items.length - 1; i >= 0; i--) {
        const item = results.items[i];
        const original = item.text || "";
        const updated = replaceFn(original);
        if (updated !== original) {
          item.insertText(updated, Word.InsertLocation.replace);
        }
      }
      await context.sync();
    };

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const result = normalizeTypographyText(para.text, options);
      if (result.changed) {
        if (options.enforceSpacing) {
          await replaceByWildcard(para, "[一-龥][A-Za-z0-9]", (text) => {
            const first = text.charAt(0); const rest = text.slice(1);
            return rest.startsWith(" ") ? text : `${first} ${rest}`;
          });
          await replaceByWildcard(para, "[A-Za-z0-9][一-龥]", (text) => {
            const first = text.charAt(0); const rest = text.slice(1);
            return rest.startsWith(" ") ? text : `${first} ${rest}`;
          });
          await replaceByWildcard(para, "[0-9][A-Za-z]", (text) => {
            const first = text.charAt(0); const rest = text.slice(1);
            return rest.startsWith(" ") ? text : `${first} ${rest}`;
          });
          await replaceByWildcard(para, "[0-9][ ]@[年年月日个项次度%℃]", (text) =>
            text.replace(/\s+/g, ""));
        }
        if (options.enforcePunctuation) {
          await replaceByWildcard(para, "[，。？！；：、][ ]@", (text) => text.charAt(0));
          await replaceByWildcard(para, "[ ]@[,\\.!?;:]", (text) => text.trimStart());
          await replaceByWildcard(para, "[一-龥][,;:!?]", (text) => {
            const cjk = text.charAt(0); const punc = text.charAt(1);
            const map: Record<string, string> = { ",": "，", ";": "；", ":": "：", "!": "！", "?": "？" };
            return cjk + (map[punc] || punc);
          });
        }
      }
      const fontAny = para.font as unknown as { name?: string; nameAscii?: string; nameEastAsia?: string };
      fontAny.name = options.chineseFont;
      fontAny.nameAscii = options.englishFont;
      fontAny.nameEastAsia = options.chineseFont;
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

export async function applyPaginationControl(paragraphIndices: number[]): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      paragraphs.items[index].load("text, style, pageBreakBefore");
    }
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const text = para.text || "";
      if (text.trim() === "") {
        if (index > 0) { para.delete(); }
        continue;
      }
      const isHeading =
        para.style?.toString().toLowerCase().includes("heading") ||
        para.style?.toString().includes("标题");
      if (isHeading) {
        (para as unknown as { keepWithNext?: boolean }).keepWithNext = true;
        (para as unknown as { keepTogether?: boolean }).keepTogether = true;
      }
      (para as unknown as { widowControl?: boolean }).widowControl = true;
      if ((para as unknown as { pageBreakBefore?: boolean }).pageBreakBefore) {
        (para as unknown as { pageBreakBefore?: boolean }).pageBreakBefore = false;
      }
    }

    await context.sync();
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
