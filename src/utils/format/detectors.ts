/**
 * AI排版服务 - 格式检测与分析
 * 检测文档中的格式不一致、颜色问题、排版问题等
 */

import {
  ParagraphInfo,
  getSectionHeadersFooters,
} from "../wordApi";
import { IssueItem } from "./types";
import {
  getDominantParagraph,
  formatMismatch,
  chineseRegex,
  englishRegex,
} from "./utils";

export function detectHeadingLevelFixes(
  headings: ParagraphInfo[]
): Array<{ index: number; level: number }> {
  const fixes: Array<{ index: number; level: number }> = [];
  let lastLevel = 0;
  for (const heading of headings) {
    const level = heading.outlineLevel || 1;
    if (lastLevel === 0) {
      lastLevel = level;
      continue;
    }
    if (level > lastLevel + 1) {
      const newLevel = lastLevel + 1;
      fixes.push({ index: heading.index, level: newLevel });
      lastLevel = newLevel;
    } else {
      lastLevel = level;
    }
  }
  return fixes;
}

export function detectHeadingConsistencyIssues(
  headings: ParagraphInfo[],
  level: number
): IssueItem[] {
  const levelHeadings = headings.filter((p) => p.outlineLevel === level);
  const reference = getDominantParagraph(levelHeadings);
  if (!reference) return [];
  const inconsistent = levelHeadings.filter((p) => formatMismatch(p, reference));
  if (inconsistent.length === 0) return [];
  return [
    {
      id: `heading-consistency-${level}`,
      description: `${level}级标题样式不一致`,
      paragraphIndices: inconsistent.map((p) => p.index),
      severity: "warning",
      sample: inconsistent[0]?.text?.slice(0, 40),
    },
  ];
}

export function detectBodyConsistencyIssues(body: ParagraphInfo[]): IssueItem[] {
  const reference = getDominantParagraph(body);
  if (!reference) return [];
  const inconsistent = body.filter((p) => formatMismatch(p, reference));
  if (inconsistent.length === 0) return [];
  return [
    {
      id: "body-consistency",
      description: "正文样式不一致",
      paragraphIndices: inconsistent.map((p) => p.index),
      severity: "warning",
      sample: inconsistent[0]?.text?.slice(0, 40),
    },
  ];
}

export function detectListConsistencyIssues(listItems: ParagraphInfo[]): IssueItem[] {
  if (listItems.length === 0) return [];
  const reference = getDominantParagraph(listItems);
  if (!reference) return [];
  const inconsistent = listItems.filter((p) => formatMismatch(p, reference));
  const issues: IssueItem[] = [];
  if (inconsistent.length > 0) {
    issues.push({
      id: "list-consistency",
      description: "列表缩进或样式不一致",
      paragraphIndices: inconsistent.map((p) => p.index),
      severity: "warning",
      sample: inconsistent[0]?.text?.slice(0, 40),
    });
  }
  return issues;
}

export function detectHierarchyIssues(headings: ParagraphInfo[]): IssueItem[] {
  const issues: IssueItem[] = [];
  let lastLevel = 0;
  for (const heading of headings) {
    const level = heading.outlineLevel || 1;
    if (lastLevel > 0 && level > lastLevel + 1) {
      issues.push({
        id: `heading-skip-${heading.index}`,
        description: "标题跳级",
        paragraphIndices: [heading.index],
        severity: "warning",
        sample: heading.text.slice(0, 40),
      });
    }
    const text = heading.text || "";
    if (text.length > 60 || /[。！？；]/.test(text)) {
      issues.push({
        id: `heading-suspect-${heading.index}`,
        description: "疑似正文误设为标题",
        paragraphIndices: [heading.index],
        severity: "info",
        sample: text.slice(0, 40),
      });
    }
    lastLevel = level;
  }
  return issues;
}

export function detectListInBodyIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const issues: IssueItem[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (!para.isListItem) continue;
    const prev = paragraphs[i - 1];
    const next = paragraphs[i + 1];
    const isIsolated = (!prev || !prev.isListItem) && (!next || !next.isListItem);
    if (isIsolated) {
      issues.push({
        id: `list-isolated-${para.index}`,
        description: "列表项与正文混排",
        paragraphIndices: [para.index],
        severity: "info",
        sample: para.text.slice(0, 40),
      });
    }
  }
  return issues;
}

export function detectColorHighlightIssues(
  paragraphs: ParagraphInfo[]
): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const color = (para.font.color || "").toLowerCase();
    if (color && color !== "#000000" && color !== "black" && color !== "#000") {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "color-highlight",
      description: "存在非必要颜色/高亮",
      paragraphIndices: indices,
      severity: "warning",
    },
  ];
}

export function detectMixedTypographyIssues(
  paragraphs: ParagraphInfo[]
): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const text = para.text || "";
    if (chineseRegex.test(text) && englishRegex.test(text)) {
      if (/[^\s][A-Za-z]/.test(text) || /[A-Za-z][^\s]/.test(text)) {
        indices.push(para.index);
      }
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "mixed-typography",
      description: "中英混排间距或字体需统一",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectPunctuationIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  const pattern = /[，。？！；：、]\s+|\s+[,.!?;:]/;
  for (const para of paragraphs) {
    if (pattern.test(para.text || "")) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "punctuation-spacing",
      description: "标点与空格使用不规范",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectPaginationIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    if (para.pageBreakBefore) {
      indices.push(para.index);
      continue;
    }
    if (para.text.trim() === "") {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "pagination-control",
      description: "存在分页符/空行或分页控制问题",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectSpecialContentIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const text = para.text || "";
    if (/^>/.test(text) || /```/.test(text) || /`[^`]+`/.test(text)) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "special-content",
      description: "引用/代码等特殊内容格式不统一",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectUnderlineIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const underline = para.font.underline;
    if (underline && underline !== "None" && underline !== "none") {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "underline-issues",
      description: "段落包含下划线格式",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectItalicIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    if (para.font.italic) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "italic-issues",
      description: "段落包含斜体格式",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectStrikethroughIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    if (para.font.strikeThrough) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "strikethrough-issues",
      description: "段落包含删除线格式",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

export function detectCaptionIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  const captionPattern = /^(图|表|图表|Figure|Table)\s*([0-9]+)?[\.：:]/i;
  let figureCounter = 0;
  let tableCounter = 0;
  for (const para of paragraphs) {
    const match = para.text.trim().match(captionPattern);
    if (!match) continue;
    const prefix = match[1].toLowerCase();
    const number = match[2] ? parseInt(match[2], 10) : null;
    if (prefix.startsWith("图") || prefix.startsWith("figure")) {
      figureCounter += 1;
      if (!number || number !== figureCounter) {
        indices.push(para.index);
      }
    } else {
      tableCounter += 1;
      if (!number || number !== tableCounter) {
        indices.push(para.index);
      }
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "caption-issues",
      description: "图/表题注编号或样式异常",
      paragraphIndices: indices,
      severity: "warning",
    },
  ];
}

export async function detectHeaderFooterIssues(): Promise<IssueItem[]> {
  const headerFooters = await getSectionHeadersFooters();
  if (headerFooters.length <= 1) return [];
  const first = headerFooters[0];
  const differences = headerFooters.some(
    (hf) =>
      hf.header.primary !== first.header.primary ||
      hf.footer.primary !== first.footer.primary ||
      hf.header.firstPage !== first.header.firstPage ||
      hf.header.evenPages !== first.header.evenPages
  );
  if (!differences) return [];
  return [
    {
      id: "header-footer-diff",
      description: "节间页眉页脚模板不一致",
      paragraphIndices: [],
      severity: "warning",
    },
  ];
}

export async function detectTableIssues(): Promise<IssueItem[]> {
  return Word.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load("items");
    await context.sync();

    if (tables.items.length === 0) return [];

    const issues: IssueItem[] = [];
    for (let i = 0; i < tables.items.length; i++) {
      const table = tables.items[i];
      table.load("style, rowCount");
    }
    await context.sync();

    const inconsistentTables = tables.items.filter(
      (table) => !table.style || table.style === "Normal Table"
    );

    if (inconsistentTables.length > 0) {
      issues.push({
        id: "table-style",
        description: "表格样式或边框不统一",
        paragraphIndices: [],
        severity: "warning",
      });
    }

    return issues;
  });
}
