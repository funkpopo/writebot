/* global Word */

import { SectionHeaderFooter } from "./types";

/**
 * 获取所有节的页眉页脚内容
 */
export async function getSectionHeadersFooters(): Promise<SectionHeaderFooter[]> {
  return Word.run(async (context) => {
    const sections = context.document.sections;
    sections.load("items");
    await context.sync();

    const sectionEntries = sections.items.map((section, sectionIndex) => {
      const primaryHeader = section.getHeader(Word.HeaderFooterType.primary);
      const firstPageHeader = section.getHeader(Word.HeaderFooterType.firstPage);
      const evenPagesHeader = section.getHeader(Word.HeaderFooterType.evenPages);
      const primaryFooter = section.getFooter(Word.HeaderFooterType.primary);
      const firstPageFooter = section.getFooter(Word.HeaderFooterType.firstPage);
      const evenPagesFooter = section.getFooter(Word.HeaderFooterType.evenPages);

      primaryHeader.load("text");
      firstPageHeader.load("text");
      evenPagesHeader.load("text");
      primaryFooter.load("text");
      firstPageFooter.load("text");
      evenPagesFooter.load("text");

      return {
        sectionIndex,
        primaryHeader,
        firstPageHeader,
        evenPagesHeader,
        primaryFooter,
        firstPageFooter,
        evenPagesFooter,
      };
    });

    await context.sync();

    const readTextSafely = (body: Word.Body): string | undefined => {
      try {
        return body.text;
      } catch {
        return undefined;
      }
    };

    return sectionEntries.map((entry) => ({
      sectionIndex: entry.sectionIndex,
      header: {
        primary: readTextSafely(entry.primaryHeader),
        firstPage: readTextSafely(entry.firstPageHeader),
        evenPages: readTextSafely(entry.evenPagesHeader),
      },
      footer: {
        primary: readTextSafely(entry.primaryFooter),
        firstPage: readTextSafely(entry.firstPageFooter),
        evenPages: readTextSafely(entry.evenPagesFooter),
      },
    }));
  });
}

/**
 * 统一应用页眉页脚到所有节
 */
export async function applyHeaderFooterToAllSections(
  headerText?: string,
  footerText?: string
): Promise<void> {
  return Word.run(async (context) => {
    const sections = context.document.sections;
    sections.load("items");
    await context.sync();

    for (const section of sections.items) {
      if (headerText !== undefined) {
        const header = section.getHeader(Word.HeaderFooterType.primary);
        header.clear();
        if (headerText) {
          header.insertText(headerText, Word.InsertLocation.start);
        }
      }

      if (footerText !== undefined) {
        const footer = section.getFooter(Word.HeaderFooterType.primary);
        footer.clear();
        if (footerText) {
          footer.insertText(footerText, Word.InsertLocation.start);
        }
      }
    }

    await context.sync();
  });
}
