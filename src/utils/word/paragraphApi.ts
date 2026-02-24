/* global Word */

import {
  FontFormat,
  LineSpacingRule,
  ParagraphFormat,
  ParagraphInfo,
  ParagraphSample,
  TableFormatSample,
  DocumentFormatSample,
  ParagraphSnapshot,
} from "./types";
import { toWordAlignment } from "./utils";

export function pickRepresentativeSamples<T>(items: T[], maxSamples: number): T[] {
  if (maxSamples <= 0 || items.length === 0) {
    return [];
  }
  if (items.length <= maxSamples) {
    return [...items];
  }
  if (maxSamples === 1) {
    return [items[Math.floor((items.length - 1) / 2)]];
  }

  const pickedIndices = new Set<number>();
  for (let i = 0; i < maxSamples; i++) {
    const ratio = i / (maxSamples - 1);
    const index = Math.round(ratio * (items.length - 1));
    pickedIndices.add(index);
  }

  return Array.from(pickedIndices)
    .sort((a, b) => a - b)
    .map((index) => items[index]);
}

export function buildScopedIndexSet(
  paragraphIndices: number[] | undefined,
  paragraphCount: number
): Set<number> | null {
  if (!paragraphIndices || paragraphIndices.length === 0) {
    return null;
  }
  const scopedIndices = new Set<number>();
  for (const index of paragraphIndices) {
    if (Number.isInteger(index) && index >= 0 && index < paragraphCount) {
      scopedIndices.add(index);
    }
  }
  return scopedIndices;
}

async function collectParagraphIndicesInRange(
  context: Word.RequestContext,
  range: Word.Range
): Promise<number[]> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items");
  await context.sync();

  const comparisons = paragraphs.items.map((para) =>
    (para.getRange() as unknown as { compareLocationWith: (r: Word.Range) => OfficeExtension.ClientResult<string> })
      .compareLocationWith(range)
  );

  await context.sync();

  const indices: number[] = [];
  for (let i = 0; i < comparisons.length; i++) {
    const relation = (comparisons[i].value || "").toString().toLowerCase();
    if (
      relation.includes("inside") ||
      relation.includes("contains") ||
      relation.includes("overlap") ||
      relation.includes("equal")
    ) {
      indices.push(i);
    }
  }

  return indices;
}

/**
 * 获取文档中的所有段落
 */
export async function getParagraphs(): Promise<string[]> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("text");
    await context.sync();
    return paragraphs.items.map((p) => p.text);
  });
}

/**
 * 获取指定索引的段落信息
 */
export async function getParagraphByIndex(index: number): Promise<ParagraphInfo | null> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    if (index < 0 || index >= paragraphs.items.length) {
      return null;
    }

    const para = paragraphs.items[index];
    const listItem = para.listItemOrNullObject;
    listItem.load("level, listString");
    para.load(
      "text, style, " +
      "font/name, font/size, font/bold, font/italic, font/underline, font/strikeThrough, font/color, font/highlightColor, " +
      "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, lineSpacingRule, spaceBefore, spaceAfter, pageBreakBefore"
    );
    await context.sync();

    const styleName = para.style?.toLowerCase() || "";
    let outlineLevel: number | undefined;
    if (styleName.includes("heading") || styleName.includes("标题")) {
      const match = styleName.match(/(\d)/);
      if (match) {
        outlineLevel = parseInt(match[1], 10);
      }
    }

    const isListItem = !listItem.isNullObject;

    return {
      index,
      text: para.text,
      styleId: para.style,
      outlineLevel,
      isListItem,
      listLevel: isListItem ? listItem.level : undefined,
      listString: isListItem ? listItem.listString : undefined,
      pageBreakBefore: (para as { pageBreakBefore?: boolean }).pageBreakBefore,
      font: {
        name: para.font.name,
        size: para.font.size,
        bold: para.font.bold,
        italic: para.font.italic,
        underline: para.font.underline,
        strikeThrough: para.font.strikeThrough,
        color: para.font.color,
        highlightColor: para.font.highlightColor,
      },
      paragraph: {
        alignment: para.alignment as string,
        firstLineIndent: para.firstLineIndent,
        leftIndent: para.leftIndent,
        rightIndent: para.rightIndent,
        lineSpacing: para.lineSpacing,
        lineSpacingRule: (para as { lineSpacingRule?: LineSpacingRule }).lineSpacingRule,
        spaceBefore: para.spaceBefore,
        spaceAfter: para.spaceAfter,
      },
    };
  });
}

/**
 * 获取选区内段落数量
 */
export async function getParagraphCountInSelection(): Promise<number> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraphs = selection.paragraphs;
    paragraphs.load("items");
    await context.sync();
    return paragraphs.items.length;
  });
}

/**
 * 获取全文段落数量
 */
export async function getParagraphCountInDocument(): Promise<number> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();
    return paragraphs.items.length;
  });
}

/**
 * 获取选区内段落索引（基于整篇文档的索引）
 */
export async function getParagraphIndicesInSelection(): Promise<number[]> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load();
    await context.sync();
    return collectParagraphIndicesInRange(context, selection);
  });
}

/**
 * 获取当前节的段落索引
 */
export async function getParagraphIndicesInCurrentSection(): Promise<number[]> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const sections = context.document.sections;
    sections.load("items");
    await context.sync();

    if (sections.items.length === 0) {
      return [];
    }

    const ranges = sections.items.map((section) =>
      (section as unknown as { getRange: () => Word.Range }).getRange()
    );
    const comparisons = ranges.map((range) =>
      (range as unknown as { compareLocationWith: (r: Word.Range) => OfficeExtension.ClientResult<string> })
        .compareLocationWith(selection)
    );

    await context.sync();

    let targetRange = ranges[0];
    for (let i = 0; i < comparisons.length; i++) {
      const relation = (comparisons[i].value || "").toString().toLowerCase();
      if (
        relation.includes("inside") ||
        relation.includes("contains") ||
        relation.includes("overlap") ||
        relation.includes("equal")
      ) {
        targetRange = ranges[i];
        break;
      }
    }

    return collectParagraphIndicesInRange(context, targetRange);
  });
}

/**
 * 选择指定索引的段落
 */
export async function selectParagraphByIndex(index: number): Promise<void> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();
    if (index >= 0 && index < paragraphs.items.length) {
      paragraphs.items[index].select();
    }
  });
}

/**
 * 高亮指定段落
 */
export async function highlightParagraphs(
  indices: number[],
  color: string = "#FFFF00"
): Promise<void> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of indices) {
      if (index >= 0 && index < paragraphs.items.length) {
        const para = paragraphs.items[index];
        const range = para.getRange();
        const highlight = color || "NoColor";
        (range.font as unknown as { highlightColor?: string }).highlightColor = highlight;
      }
    }

    await context.sync();
  });
}

/**
 * 清除指定段落高亮
 */
export async function clearParagraphHighlights(indices: number[]): Promise<void> {
  if (indices.length === 0) return;
  try {
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();

      for (const index of indices) {
        if (index >= 0 && index < paragraphs.items.length) {
          const para = paragraphs.items[index];
          (para.font as unknown as { highlightColor?: string }).highlightColor = "NoColor";
        }
      }

      await context.sync();
    });
  } catch {
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();

      for (const index of indices) {
        if (index >= 0 && index < paragraphs.items.length) {
          const para = paragraphs.items[index];
          const range = para.getRange();
          (range.font as unknown as { highlightColor?: string }).highlightColor = "#FFFFFF";
        }
      }

      await context.sync();
    });
  }
}

/**
 * 获取段落快照
 */
export async function getParagraphSnapshots(
  indices: number[]
): Promise<ParagraphSnapshot[]> {
  if (indices.length === 0) return [];

  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const uniqueIndices = Array.from(new Set(indices)).filter(
      (index) => index >= 0 && index < paragraphs.items.length
    );

    const listItems = uniqueIndices.map((index) => {
      const listItem = paragraphs.items[index].listItemOrNullObject;
      listItem.load("level, listString");
      return listItem;
    });

    for (const index of uniqueIndices) {
      paragraphs.items[index].load(
        "text, style, " +
        "font/name, font/size, font/bold, font/italic, font/color, " +
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, lineSpacingRule, spaceBefore, spaceAfter"
      );
    }

    await context.sync();

    return uniqueIndices.map((index, i) => {
      const para = paragraphs.items[index];
      const listItem = listItems[i];
      const isListItem = !listItem.isNullObject;

      return {
        index,
        text: para.text,
        styleId: para.style,
        isListItem,
        listLevel: isListItem ? listItem.level : undefined,
        font: {
          name: para.font.name,
          size: para.font.size,
          bold: para.font.bold,
          italic: para.font.italic,
          color: para.font.color,
          underline: para.font.underline as string,
          strikeThrough: para.font.strikeThrough,
          highlightColor: para.font.highlightColor as string,
        },
        paragraph: {
          alignment: para.alignment as string,
          firstLineIndent: para.firstLineIndent,
          leftIndent: para.leftIndent,
          rightIndent: para.rightIndent,
          lineSpacing: para.lineSpacing,
          lineSpacingRule: (para as { lineSpacingRule?: LineSpacingRule }).lineSpacingRule,
          spaceBefore: para.spaceBefore,
          spaceAfter: para.spaceAfter,
        },
      };
    });
  });
}

/**
 * 还原段落快照
 */
export async function restoreParagraphSnapshots(
  snapshots: ParagraphSnapshot[]
): Promise<void> {
  if (snapshots.length === 0) return;

  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const snapshot of snapshots) {
      if (snapshot.index < 0 || snapshot.index >= paragraphs.items.length) continue;

      const para = paragraphs.items[snapshot.index];
      para.insertText(snapshot.text, Word.InsertLocation.replace);

      if (snapshot.styleId) {
        para.style = snapshot.styleId;
      }

      if (snapshot.font.name) para.font.name = snapshot.font.name;
      if (snapshot.font.size) para.font.size = snapshot.font.size;
      if (snapshot.font.bold !== undefined) para.font.bold = snapshot.font.bold;
      if (snapshot.font.italic !== undefined) para.font.italic = snapshot.font.italic;
      if (snapshot.font.color) para.font.color = snapshot.font.color;
      if (snapshot.font.underline) {
        para.font.underline = snapshot.font.underline as Word.UnderlineType;
      }
      if (snapshot.font.strikeThrough !== undefined) {
        para.font.strikeThrough = snapshot.font.strikeThrough;
      }
      if (snapshot.font.highlightColor) {
        (para.font as unknown as { highlightColor?: string }).highlightColor = snapshot.font.highlightColor;
      }

      if (snapshot.paragraph.alignment) {
        const wordAlignment = toWordAlignment(snapshot.paragraph.alignment);
        if (wordAlignment) {
          para.alignment = wordAlignment;
        }
      }
      if (snapshot.paragraph.firstLineIndent !== undefined) {
        para.firstLineIndent = snapshot.paragraph.firstLineIndent;
      }
      if (snapshot.paragraph.leftIndent !== undefined) {
        para.leftIndent = snapshot.paragraph.leftIndent;
      }
      if (snapshot.paragraph.rightIndent !== undefined) {
        para.rightIndent = snapshot.paragraph.rightIndent;
      }
      if (snapshot.paragraph.lineSpacing !== undefined) {
        para.lineSpacing = snapshot.paragraph.lineSpacing;
      }
      if (snapshot.paragraph.spaceBefore !== undefined) {
        para.spaceBefore = snapshot.paragraph.spaceBefore;
      }
      if (snapshot.paragraph.spaceAfter !== undefined) {
        para.spaceAfter = snapshot.paragraph.spaceAfter;
      }
    }

    await context.sync();
  });
}

/**
 * 采样文档格式，返回各类型段落的格式样本
 */
export async function sampleDocumentFormats(
  maxSamplesPerType: number = 5,
  options?: { paragraphIndices?: number[]; includeTables?: boolean }
): Promise<DocumentFormatSample> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    const tables = context.document.body.tables;
    const shouldSampleTables = options?.includeTables ?? !options?.paragraphIndices?.length;
    paragraphs.load("items");
    if (shouldSampleTables) {
      tables.load("items");
    }
    await context.sync();

    const scopedIndexSet = buildScopedIndexSet(options?.paragraphIndices, paragraphs.items.length);

    const headingCandidates: ParagraphSample[] = [];
    const bodyCandidates: ParagraphSample[] = [];
    const listCandidates: ParagraphSample[] = [];
    const tableSamples: TableFormatSample[] = [];

    const listItems = paragraphs.items.map((para) => {
      const listItem = para.listItemOrNullObject;
      listItem.load("level");
      return listItem;
    });

    for (const para of paragraphs.items) {
      para.load(
        "text, style, " +
        "font/name, font/size, font/bold, font/italic, font/color, " +
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, lineSpacingRule, spaceBefore, spaceAfter"
      );
    }
    await context.sync();

    for (let i = 0; i < paragraphs.items.length; i++) {
      if (scopedIndexSet && !scopedIndexSet.has(i)) {
        continue;
      }
      const para = paragraphs.items[i];
      const text = para.text?.trim() || "";
      if (!text) continue;

      const listItem = listItems[i];
      const isListItem = !listItem.isNullObject;

      const styleName = para.style?.toLowerCase() || "";
      let outlineLevel: number | undefined;
      if (styleName.includes("heading") || styleName.includes("标题")) {
        const match = styleName.match(/(\d)/);
        if (match) {
          outlineLevel = parseInt(match[1], 10);
        }
      }

      const sample: ParagraphSample = {
        text: text.length > 100 ? text.substring(0, 100) + "..." : text,
        styleId: para.style,
        outlineLevel,
        font: {
          name: para.font.name,
          size: para.font.size,
          bold: para.font.bold,
          italic: para.font.italic,
          color: para.font.color,
        },
        paragraph: {
          alignment: para.alignment as string,
          firstLineIndent: para.firstLineIndent,
          leftIndent: para.leftIndent,
          rightIndent: para.rightIndent,
          lineSpacing: para.lineSpacing,
          lineSpacingRule: (para as { lineSpacingRule?: LineSpacingRule }).lineSpacingRule,
          spaceBefore: para.spaceBefore,
          spaceAfter: para.spaceAfter,
        },
        index: i,
      };

      if (outlineLevel !== undefined && outlineLevel >= 1 && outlineLevel <= 9) {
        headingCandidates.push(sample);
      } else if (isListItem) {
        listCandidates.push(sample);
      } else {
        bodyCandidates.push(sample);
      }
    }

    if (shouldSampleTables && tables.items.length > 0) {
      const tableSampleCount = Math.min(tables.items.length, maxSamplesPerType);
      for (let i = 0; i < tableSampleCount; i++) {
        tables.items[i].load("rowCount, values");
      }
      await context.sync();

      for (let i = 0; i < tableSampleCount; i++) {
        try {
          const table = tables.items[i];
          tableSamples.push({
            rowCount: table.rowCount,
            columnCount: table.values[0]?.length || 0,
            index: i,
          });
        } catch {
          // 跳过无法访问的表格
        }
      }
    }

    const headings = pickRepresentativeSamples(headingCandidates, maxSamplesPerType);
    const bodyText = pickRepresentativeSamples(bodyCandidates, maxSamplesPerType);
    const lists = pickRepresentativeSamples(listCandidates, maxSamplesPerType);

    return {
      headings,
      bodyText,
      lists,
      tables: tableSamples,
    };
  });
}

/**
 * 获取所有段落的基本信息和格式
 */
export async function getAllParagraphsInfo(): Promise<ParagraphInfo[]> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const result: ParagraphInfo[] = [];

    const listItems = paragraphs.items.map((para) => {
      const listItem = para.listItemOrNullObject;
      listItem.load("level, listString");
      return listItem;
    });

    for (const para of paragraphs.items) {
      para.load(
        "text, style, " +
        "font/name, font/size, font/bold, font/italic, font/underline, font/strikeThrough, font/color, font/highlightColor, " +
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, lineSpacingRule, spaceBefore, spaceAfter, pageBreakBefore"
      );
    }
    await context.sync();

    for (let i = 0; i < paragraphs.items.length; i++) {
      const para = paragraphs.items[i];

      const listItem = listItems[i];
      const isListItem = !listItem.isNullObject;

      const styleName = para.style?.toLowerCase() || "";
      let outlineLevel: number | undefined;
      if (styleName.includes("heading") || styleName.includes("标题")) {
        const match = styleName.match(/(\d)/);
        if (match) {
          outlineLevel = parseInt(match[1], 10);
        }
      }

      result.push({
        index: i,
        text: para.text,
        styleId: para.style,
        outlineLevel,
        isListItem,
        listLevel: isListItem ? listItem.level : undefined,
        listString: isListItem ? listItem.listString : undefined,
        pageBreakBefore: (para as { pageBreakBefore?: boolean }).pageBreakBefore,
        font: {
          name: para.font.name,
          size: para.font.size,
          bold: para.font.bold,
          italic: para.font.italic,
          underline: para.font.underline,
          strikeThrough: para.font.strikeThrough,
          color: para.font.color,
          highlightColor: para.font.highlightColor,
        },
        paragraph: {
          alignment: para.alignment as string,
          firstLineIndent: para.firstLineIndent,
          leftIndent: para.leftIndent,
          rightIndent: para.rightIndent,
          lineSpacing: para.lineSpacing,
          lineSpacingRule: (para as { lineSpacingRule?: LineSpacingRule }).lineSpacingRule,
          spaceBefore: para.spaceBefore,
          spaceAfter: para.spaceAfter,
        },
      });
    }

    return result;
  });
}

export interface BodyDefaultFormat {
  font: FontFormat;
  paragraph: ParagraphFormat;
  paragraphCount: number;
}

/**
 * 读取文档正文的默认格式（取第一个非标题、有文本的段落）。
 * 同时返回当前段落总数，方便插入后做差量归一化。
 */
export async function getBodyDefaultFormat(): Promise<BodyDefaultFormat | null> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const count = paragraphs.items.length;
    if (count === 0) return null;

    // 加载所有段落的基本信息以找到第一个正文段落
    for (const p of paragraphs.items) {
      p.load("text, style, outlineLevel");
      p.font.load("name, size, bold, italic, color");
    }
    await context.sync();

    // 找第一个非标题、有文本的段落
    let target: Word.Paragraph | null = null;
    for (const p of paragraphs.items) {
      const isHeading =
        (p.outlineLevel !== undefined && p.outlineLevel >= 0 && p.outlineLevel <= 8)
        || /heading/i.test(p.style || "");
      if (isHeading) continue;
      if (!p.text.trim()) continue;
      target = p;
      break;
    }

    if (!target) return null;

    target.load(
      "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, spaceBefore, spaceAfter"
    );
    await context.sync();

    return {
      font: {
        name: target.font.name || undefined,
        size: target.font.size || undefined,
        bold: target.font.bold,
        italic: target.font.italic,
        color: target.font.color || undefined,
      },
      paragraph: {
        alignment: target.alignment as string,
        firstLineIndent: target.firstLineIndent,
        leftIndent: target.leftIndent,
        rightIndent: target.rightIndent,
        lineSpacing: target.lineSpacing,
        spaceBefore: target.spaceBefore,
        spaceAfter: target.spaceAfter,
      },
      paragraphCount: count,
    };
  });
}

/**
 * 对 index >= startIndex 的非标题段落应用正文格式，使新插入内容与已有内容一致。
 */
export async function normalizeNewParagraphsFormat(
  startIndex: number,
  bodyFormat: BodyDefaultFormat,
): Promise<void> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const items = paragraphs.items;
    if (startIndex >= items.length) return;

    for (let i = startIndex; i < items.length; i++) {
      items[i].load("style, outlineLevel, text");
    }
    await context.sync();

    for (let i = startIndex; i < items.length; i++) {
      const p = items[i];
      const isHeading =
        (p.outlineLevel !== undefined && p.outlineLevel >= 0 && p.outlineLevel <= 8)
        || /heading/i.test(p.style || "");
      if (isHeading) continue;
      if (!p.text.trim()) continue;

      // 应用字体
      if (bodyFormat.font.name) p.font.name = bodyFormat.font.name;
      if (bodyFormat.font.size) p.font.size = bodyFormat.font.size;

      // 应用段落格式
      if (bodyFormat.paragraph.lineSpacing !== undefined) {
        p.lineSpacing = bodyFormat.paragraph.lineSpacing;
      }
      if (bodyFormat.paragraph.firstLineIndent !== undefined) {
        p.firstLineIndent = bodyFormat.paragraph.firstLineIndent;
      }
      if (bodyFormat.paragraph.spaceBefore !== undefined) {
        p.spaceBefore = bodyFormat.paragraph.spaceBefore;
      }
      if (bodyFormat.paragraph.spaceAfter !== undefined) {
        p.spaceAfter = bodyFormat.paragraph.spaceAfter;
      }
    }

    await context.sync();
  });
}
