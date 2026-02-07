/* global Word, Office */

import {
  SearchResult,
  DocumentSnapshot,
  SectionSnapshot,
  HeaderFooterSnapshot,
} from "./types";
import { escapeRegExp, countOccurrences } from "./utils";

/**
 * 获取整个文档的文本内容
 */
export async function getDocumentText(): Promise<string> {
  return Word.run(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    return body.text;
  });
}

/**
 * 搜索文档内容（按段落返回匹配结果）
 */
export async function searchDocument(
  query: string,
  options?: { matchCase?: boolean; matchWholeWord?: boolean }
): Promise<SearchResult[]> {
  const matchCase = options?.matchCase ?? false;
  const matchWholeWord = options?.matchWholeWord ?? false;

  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("text");
    await context.sync();

    const results: SearchResult[] = [];
    const needle = matchCase ? query : query.toLowerCase();
    const wholeWordRegex = matchWholeWord
      ? new RegExp(`\\b${escapeRegExp(needle)}\\b`, matchCase ? "g" : "gi")
      : null;

    paragraphs.items.forEach((para, index) => {
      const text = para.text || "";
      if (!text) return;

      if (matchWholeWord && wholeWordRegex) {
        const matches = text.match(wholeWordRegex);
        if (matches && matches.length > 0) {
          results.push({
            index,
            text,
            matchCount: matches.length,
          });
        }
        return;
      }

      const haystack = matchCase ? text : text.toLowerCase();
      const count = countOccurrences(haystack, needle);
      if (count > 0) {
        results.push({
          index,
          text,
          matchCount: count,
        });
      }
    });

    return results;
  });
}

/**
 * 获取文档名称（用于页眉页脚字段）
 */
export async function getDocumentName(): Promise<string> {
  return Word.run(async (context) => {
    const properties = context.document.properties;
    properties.load("title");
    await context.sync();

    const title = properties.title;
    if (title) return title;

    const url = Office.context.document?.url || "";
    if (!url) return "文档";
    const parts = url.split(/[\\/]/);
    const last = parts[parts.length - 1];
    return last || "文档";
  });
}

/**
 * 获取文档 OOXML 快照
 */
export async function getDocumentOoxml(): Promise<DocumentSnapshot> {
  const baseSnapshot = await Word.run(async (context) => {
    const body = context.document.body;
    const ooxml = body.getOoxml();
    await context.sync();
    return {
      ooxml: ooxml.value,
      createdAt: Date.now(),
    };
  });

  try {
    const sectionsSnapshot = await Word.run(async (context) => {
      const sections = context.document.sections;
      sections.load("items");
      await context.sync();

      const sectionResults = sections.items.map((section, index) => {
        const pageSetup = section.pageSetup;
        pageSetup.load("differentFirstPageHeaderFooter, oddAndEvenPagesHeaderFooter");

        const primaryHeader = section.getHeader(Word.HeaderFooterType.primary);
        const primaryFooter = section.getFooter(Word.HeaderFooterType.primary);
        const firstHeader = section.getHeader(Word.HeaderFooterType.firstPage);
        const firstFooter = section.getFooter(Word.HeaderFooterType.firstPage);
        const evenHeader = section.getHeader(Word.HeaderFooterType.evenPages);
        const evenFooter = section.getFooter(Word.HeaderFooterType.evenPages);

        primaryHeader.load("text");
        primaryFooter.load("text");
        firstHeader.load("text");
        firstFooter.load("text");
        evenHeader.load("text");
        evenFooter.load("text");

        const primaryHeaderOoxml = (primaryHeader as unknown as {
          getOoxml?: () => OfficeExtension.ClientResult<string>;
        }).getOoxml?.();
        const primaryFooterOoxml = (primaryFooter as unknown as {
          getOoxml?: () => OfficeExtension.ClientResult<string>;
        }).getOoxml?.();
        const firstHeaderOoxml = (firstHeader as unknown as {
          getOoxml?: () => OfficeExtension.ClientResult<string>;
        }).getOoxml?.();
        const firstFooterOoxml = (firstFooter as unknown as {
          getOoxml?: () => OfficeExtension.ClientResult<string>;
        }).getOoxml?.();
        const evenHeaderOoxml = (evenHeader as unknown as {
          getOoxml?: () => OfficeExtension.ClientResult<string>;
        }).getOoxml?.();
        const evenFooterOoxml = (evenFooter as unknown as {
          getOoxml?: () => OfficeExtension.ClientResult<string>;
        }).getOoxml?.();

        return {
          index,
          pageSetup,
          headers: {
            primary: primaryHeader,
            first: firstHeader,
            even: evenHeader,
          },
          footers: {
            primary: primaryFooter,
            first: firstFooter,
            even: evenFooter,
          },
          ooxmlResults: {
            primaryHeader: primaryHeaderOoxml,
            primaryFooter: primaryFooterOoxml,
            firstHeader: firstHeaderOoxml,
            firstFooter: firstFooterOoxml,
            evenHeader: evenHeaderOoxml,
            evenFooter: evenFooterOoxml,
          },
        };
      });

      await context.sync();

      const snapshot: SectionSnapshot[] = sectionResults.map((result) => ({
        sectionIndex: result.index,
        pageSetup: {
          differentFirstPageHeaderFooter: result.pageSetup.differentFirstPageHeaderFooter,
          oddAndEvenPagesHeaderFooter: result.pageSetup.oddAndEvenPagesHeaderFooter,
        },
        header: {
          primary: {
            text: result.headers.primary.text,
            ooxml: result.ooxmlResults.primaryHeader?.value,
          },
          firstPage: {
            text: result.headers.first.text,
            ooxml: result.ooxmlResults.firstHeader?.value,
          },
          evenPages: {
            text: result.headers.even.text,
            ooxml: result.ooxmlResults.evenHeader?.value,
          },
        },
        footer: {
          primary: {
            text: result.footers.primary.text,
            ooxml: result.ooxmlResults.primaryFooter?.value,
          },
          firstPage: {
            text: result.footers.first.text,
            ooxml: result.ooxmlResults.firstFooter?.value,
          },
          evenPages: {
            text: result.footers.even.text,
            ooxml: result.ooxmlResults.evenFooter?.value,
          },
        },
      }));

      return snapshot;
    });

    return {
      ...baseSnapshot,
      sections: sectionsSnapshot,
    };
  } catch (error) {
    console.warn("获取页眉页脚快照失败，将仅保存正文 OOXML:", error);
    return baseSnapshot;
  }
}

/**
 * 获取文档正文 OOXML 快照（不包含页眉页脚等扩展信息）
 */
export async function getDocumentBodyOoxml(): Promise<DocumentSnapshot> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const ooxml = body.getOoxml();
    await context.sync();
    return {
      ooxml: ooxml.value,
      createdAt: Date.now(),
    };
  });
}

/**
 * 还原文档 OOXML
 */
export async function restoreDocumentOoxml(snapshot: DocumentSnapshot | string): Promise<void> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const ooxml = typeof snapshot === "string" ? snapshot : snapshot.ooxml;
    body.insertOoxml(ooxml, Word.InsertLocation.replace);
    await context.sync();

    if (typeof snapshot === "string" || !snapshot.sections?.length) {
      return;
    }

    const sections = context.document.sections;
    sections.load("items");
    await context.sync();

    const applyHeaderFooterSnapshot = (
      target: Word.Body,
      data?: HeaderFooterSnapshot
    ) => {
      if (!data) return;
      target.clear();
      const insertOoxml = (target as unknown as {
        insertOoxml?: (ooxml: string, location: Word.InsertLocation) => void;
      }).insertOoxml;
      if (data.ooxml && insertOoxml) {
        insertOoxml.call(target, data.ooxml, Word.InsertLocation.replace);
        return;
      }
      if (data.text) {
        target.insertText(data.text, Word.InsertLocation.start);
      }
    };

    for (const sectionSnapshot of snapshot.sections) {
      if (sectionSnapshot.sectionIndex < 0 || sectionSnapshot.sectionIndex >= sections.items.length) {
        continue;
      }

      const section = sections.items[sectionSnapshot.sectionIndex];
      const pageSetup = section.pageSetup as unknown as {
        differentFirstPageHeaderFooter?: boolean;
        oddAndEvenPagesHeaderFooter?: boolean;
      };

      if (sectionSnapshot.pageSetup) {
        if (sectionSnapshot.pageSetup.differentFirstPageHeaderFooter !== undefined) {
          pageSetup.differentFirstPageHeaderFooter =
            sectionSnapshot.pageSetup.differentFirstPageHeaderFooter;
        }
        if (sectionSnapshot.pageSetup.oddAndEvenPagesHeaderFooter !== undefined) {
          pageSetup.oddAndEvenPagesHeaderFooter =
            sectionSnapshot.pageSetup.oddAndEvenPagesHeaderFooter;
        }
      }

      const primaryHeader = section.getHeader(Word.HeaderFooterType.primary);
      const primaryFooter = section.getFooter(Word.HeaderFooterType.primary);
      const firstHeader = section.getHeader(Word.HeaderFooterType.firstPage);
      const firstFooter = section.getFooter(Word.HeaderFooterType.firstPage);
      const evenHeader = section.getHeader(Word.HeaderFooterType.evenPages);
      const evenFooter = section.getFooter(Word.HeaderFooterType.evenPages);

      applyHeaderFooterSnapshot(primaryHeader, sectionSnapshot.header.primary);
      applyHeaderFooterSnapshot(primaryFooter, sectionSnapshot.footer.primary);
      applyHeaderFooterSnapshot(firstHeader, sectionSnapshot.header.firstPage);
      applyHeaderFooterSnapshot(firstFooter, sectionSnapshot.footer.firstPage);
      applyHeaderFooterSnapshot(evenHeader, sectionSnapshot.header.evenPages);
      applyHeaderFooterSnapshot(evenFooter, sectionSnapshot.footer.evenPages);
    }

    await context.sync();
  });
}
