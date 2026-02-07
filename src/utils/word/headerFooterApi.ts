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

    const result: SectionHeaderFooter[] = [];

    for (let i = 0; i < sections.items.length; i++) {
      const section = sections.items[i];
      const headerFooterInfo: SectionHeaderFooter = {
        sectionIndex: i,
        header: {},
        footer: {},
      };

      try {
        // 获取主页眉
        const primaryHeader = section.getHeader(Word.HeaderFooterType.primary);
        primaryHeader.load("text");
        await context.sync();
        headerFooterInfo.header.primary = primaryHeader.text;
      } catch {
        // 页眉可能不存在
      }

      try {
        // 获取首页页眉
        const firstPageHeader = section.getHeader(Word.HeaderFooterType.firstPage);
        firstPageHeader.load("text");
        await context.sync();
        headerFooterInfo.header.firstPage = firstPageHeader.text;
      } catch {
        // 首页页眉可能不存在
      }

      try {
        // 获取偶数页页眉
        const evenPagesHeader = section.getHeader(Word.HeaderFooterType.evenPages);
        evenPagesHeader.load("text");
        await context.sync();
        headerFooterInfo.header.evenPages = evenPagesHeader.text;
      } catch {
        // 偶数页页眉可能不存在
      }

      try {
        // 获取主页脚
        const primaryFooter = section.getFooter(Word.HeaderFooterType.primary);
        primaryFooter.load("text");
        await context.sync();
        headerFooterInfo.footer.primary = primaryFooter.text;
      } catch {
        // 页脚可能不存在
      }

      try {
        // 获取首页页脚
        const firstPageFooter = section.getFooter(Word.HeaderFooterType.firstPage);
        firstPageFooter.load("text");
        await context.sync();
        headerFooterInfo.footer.firstPage = firstPageFooter.text;
      } catch {
        // 首页页脚可能不存在
      }

      try {
        // 获取偶数页页脚
        const evenPagesFooter = section.getFooter(Word.HeaderFooterType.evenPages);
        evenPagesFooter.load("text");
        await context.sync();
        headerFooterInfo.footer.evenPages = evenPagesFooter.text;
      } catch {
        // 偶数页页脚可能不存在
      }

      result.push(headerFooterInfo);
    }

    return result;
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
