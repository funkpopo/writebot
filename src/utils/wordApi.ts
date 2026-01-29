/* global Word, Office */

/**
 * 字体格式信息接口
 */
export interface FontFormat {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  strikeThrough?: boolean;
  color?: string;
  highlightColor?: string;
}

/**
 * 行距规则类型
 * - "multiple": 多倍行距（如 1.5 表示 1.5 倍行距）
 * - "exactly": 固定值（以磅为单位）
 * - "atLeast": 最小值（以磅为单位）
 */
export type LineSpacingRule = "multiple" | "exactly" | "atLeast";

/**
 * 段落格式信息接口
 */
export interface ParagraphFormat {
  alignment?: string;
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  lineSpacing?: number;
  lineSpacingRule?: LineSpacingRule;
  spaceBefore?: number;
  spaceAfter?: number;
}

/**
 * 完整格式信息接口
 */
export interface TextFormat {
  font: FontFormat;
  paragraph: ParagraphFormat;
}

/**
 * 获取当前选中的文本
 */
export async function getSelectedText(): Promise<string> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load("text");
    await context.sync();
    return selection.text;
  });
}

/**
 * 获取选中文本及其格式信息
 */
export async function getSelectedTextWithFormat(): Promise<{
  text: string;
  format: TextFormat;
}> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraphs = selection.paragraphs;

    // 加载文本和字体属性
    selection.load("text");
    selection.font.load(
      "name, size, bold, italic, underline, strikeThrough, color, highlightColor"
    );

    // 加载段落格式（取第一个段落的格式作为参考）
    paragraphs.load("items");
    await context.sync();

    // 获取字体格式
    const fontFormat: FontFormat = {
      name: selection.font.name,
      size: selection.font.size,
      bold: selection.font.bold,
      italic: selection.font.italic,
      underline: selection.font.underline as string,
      strikeThrough: selection.font.strikeThrough,
      color: selection.font.color,
      highlightColor: selection.font.highlightColor as string,
    };

    // 获取段落格式
    let paragraphFormat: ParagraphFormat = {};
    if (paragraphs.items.length > 0) {
      const firstParagraph = paragraphs.items[0];
      firstParagraph.load(
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, spaceBefore, spaceAfter"
      );
      await context.sync();

      paragraphFormat = {
        alignment: firstParagraph.alignment as string,
        firstLineIndent: firstParagraph.firstLineIndent,
        leftIndent: firstParagraph.leftIndent,
        rightIndent: firstParagraph.rightIndent,
        lineSpacing: firstParagraph.lineSpacing,
        spaceBefore: firstParagraph.spaceBefore,
        spaceAfter: firstParagraph.spaceAfter,
      };
    }

    return {
      text: selection.text,
      format: {
        font: fontFormat,
        paragraph: paragraphFormat,
      },
    };
  });
}

/**
 * 添加选择变化事件监听器
 */
export function addSelectionChangedHandler(
  handler: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.document.addHandlerAsync(
      Office.EventType.DocumentSelectionChanged,
      handler,
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve();
        } else {
          reject(result.error);
        }
      }
    );
  });
}

/**
 * 移除选择变化事件监听器
 */
export function removeSelectionChangedHandler(
  handler: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.document.removeHandlerAsync(
      Office.EventType.DocumentSelectionChanged,
      { handler },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve();
        } else {
          reject(result.error);
        }
      }
    );
  });
}

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
 * 替换选中的文本
 */
export async function replaceSelectedText(newText: string): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(newText, Word.InsertLocation.replace);
    await context.sync();
  });
}

/**
 * 替换选中的文本并保留原有格式
 */
export async function replaceSelectedTextWithFormat(
  newText: string,
  format: TextFormat
): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();

    // 插入新文本并获取插入后的范围
    const newRange = selection.insertText(newText, Word.InsertLocation.replace);

    // 应用字体格式
    const font = format.font;
    if (font.name) newRange.font.name = font.name;
    if (font.size) newRange.font.size = font.size;
    if (font.bold !== undefined) newRange.font.bold = font.bold;
    if (font.italic !== undefined) newRange.font.italic = font.italic;
    if (font.underline) {
      newRange.font.underline = font.underline as Word.UnderlineType;
    }
    if (font.strikeThrough !== undefined) {
      newRange.font.strikeThrough = font.strikeThrough;
    }
    if (font.color) newRange.font.color = font.color;
    if (font.highlightColor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newRange.font.highlightColor = font.highlightColor as any;
    }

    // 应用段落格式
    const paragraphFormat = format.paragraph;
    const paragraphs = newRange.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const paragraph of paragraphs.items) {
      if (paragraphFormat.alignment) {
        paragraph.alignment = paragraphFormat.alignment as Word.Alignment;
      }
      if (paragraphFormat.firstLineIndent !== undefined) {
        paragraph.firstLineIndent = paragraphFormat.firstLineIndent;
      }
      if (paragraphFormat.leftIndent !== undefined) {
        paragraph.leftIndent = paragraphFormat.leftIndent;
      }
      if (paragraphFormat.rightIndent !== undefined) {
        paragraph.rightIndent = paragraphFormat.rightIndent;
      }
      if (paragraphFormat.lineSpacing !== undefined) {
        paragraph.lineSpacing = paragraphFormat.lineSpacing;
      }
      if (paragraphFormat.spaceBefore !== undefined) {
        paragraph.spaceBefore = paragraphFormat.spaceBefore;
      }
      if (paragraphFormat.spaceAfter !== undefined) {
        paragraph.spaceAfter = paragraphFormat.spaceAfter;
      }
    }

    await context.sync();
  });
}

/**
 * 在光标位置插入文本
 */
export async function insertText(text: string): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(text, Word.InsertLocation.end);
    await context.sync();
  });
}

/**
 * 在文档末尾插入文本
 */
export async function appendText(text: string): Promise<void> {
  return Word.run(async (context) => {
    const body = context.document.body;
    body.insertText(text, Word.InsertLocation.end);
    await context.sync();
  });
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

// ==================== AI排版功能相关接口和函数 ====================

/**
 * 段落样本接口
 */
export interface ParagraphSample {
  text: string;
  styleId?: string;
  outlineLevel?: number;
  font: FontFormat;
  paragraph: ParagraphFormat;
  index: number;
}

/**
 * 表格格式样本接口
 */
export interface TableFormatSample {
  rowCount: number;
  columnCount: number;
  index: number;
}

/**
 * 文档格式采样结果接口
 */
export interface DocumentFormatSample {
  headings: ParagraphSample[];
  bodyText: ParagraphSample[];
  lists: ParagraphSample[];
  tables: TableFormatSample[];
}

/**
 * 段落基本信息接口
 */
export interface ParagraphInfo {
  index: number;
  text: string;
  styleId?: string;
  outlineLevel?: number;
  isListItem: boolean;
  font: FontFormat;
  paragraph: ParagraphFormat;
}

/**
 * 节的页眉页脚信息接口
 */
export interface SectionHeaderFooter {
  sectionIndex: number;
  header: {
    primary?: string;
    firstPage?: string;
    evenPages?: string;
  };
  footer: {
    primary?: string;
    firstPage?: string;
    evenPages?: string;
  };
}

/**
 * 采样文档格式，返回各类型段落的格式样本
 * 采用采样策略减少数据量，每种类型最多采样指定数量
 */
export async function sampleDocumentFormats(
  maxSamplesPerType: number = 5
): Promise<DocumentFormatSample> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    const tables = context.document.body.tables;

    paragraphs.load("items");
    tables.load("items");
    await context.sync();

    const headings: ParagraphSample[] = [];
    const bodyText: ParagraphSample[] = [];
    const lists: ParagraphSample[] = [];
    const tableSamples: TableFormatSample[] = [];

    // 加载所有段落的基本属性（不包括 listItem 和 outlineLevel）
    for (const para of paragraphs.items) {
      para.load(
        "text, style, " +
        "font/name, font/size, font/bold, font/italic, font/color, " +
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, spaceBefore, spaceAfter"
      );
    }
    await context.sync();

    // 分类采样段落
    for (let i = 0; i < paragraphs.items.length; i++) {
      const para = paragraphs.items[i];
      const text = para.text?.trim() || "";
      if (!text) continue;

      // 检查是否是列表项
      let isListItem = false;
      try {
        const listItem = para.listItem;
        listItem.load("level");
        await context.sync();
        isListItem = true;
      } catch {
        // 不是列表项
      }

      // 通过样式名称判断是否是标题
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
          spaceBefore: para.spaceBefore,
          spaceAfter: para.spaceAfter,
        },
        index: i,
      };

      // 根据大纲级别和样式分类
      if (outlineLevel !== undefined && outlineLevel >= 1 && outlineLevel <= 9) {
        if (headings.length < maxSamplesPerType) {
          headings.push(sample);
        }
      } else if (isListItem) {
        if (lists.length < maxSamplesPerType) {
          lists.push(sample);
        }
      } else {
        if (bodyText.length < maxSamplesPerType) {
          bodyText.push(sample);
        }
      }
    }

    // 采样表格
    if (tables.items.length > 0) {
      for (let i = 0; i < Math.min(tables.items.length, maxSamplesPerType); i++) {
        try {
          const table = tables.items[i];
          table.load("rowCount, values");
          await context.sync();
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

    // 加载所有段落的基本属性（不包括 listItem 和 outlineLevel）
    for (const para of paragraphs.items) {
      para.load(
        "text, style, " +
        "font/name, font/size, font/bold, font/italic, font/color, " +
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, spaceBefore, spaceAfter"
      );
    }
    await context.sync();

    for (let i = 0; i < paragraphs.items.length; i++) {
      const para = paragraphs.items[i];

      // 检查是否是列表项
      let isListItem = false;
      try {
        const listItem = para.listItem;
        listItem.load("level");
        await context.sync();
        isListItem = true;
      } catch {
        // 不是列表项
      }

      // 通过样式名称判断是否是标题
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
          spaceBefore: para.spaceBefore,
          spaceAfter: para.spaceAfter,
        },
      });
    }

    return result;
  });
}

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

// ==================== 内容安全校验机制 ====================

/**
 * 内容检查点接口
 */
export interface ContentCheckpoint {
  paragraphCount: number;
  totalCharCount: number;
  paragraphHashes: string[];
}

/**
 * 简单哈希函数
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * 创建内容检查点
 */
export async function createContentCheckpoint(): Promise<ContentCheckpoint> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const hashes: string[] = [];
    let totalChars = 0;

    for (const para of paragraphs.items) {
      para.load("text");
    }
    await context.sync();

    for (const para of paragraphs.items) {
      hashes.push(simpleHash(para.text));
      totalChars += para.text.length;
    }

    return {
      paragraphCount: paragraphs.items.length,
      totalCharCount: totalChars,
      paragraphHashes: hashes,
    };
  });
}

/**
 * 验证内容完整性
 */
export function verifyContentIntegrity(
  before: ContentCheckpoint,
  after: ContentCheckpoint
): { valid: boolean; error?: string } {
  if (before.paragraphCount !== after.paragraphCount) {
    return {
      valid: false,
      error: `段落数量变化: ${before.paragraphCount} -> ${after.paragraphCount}`,
    };
  }
  if (before.totalCharCount !== after.totalCharCount) {
    return {
      valid: false,
      error: `字符数变化: ${before.totalCharCount} -> ${after.totalCharCount}`,
    };
  }
  for (let i = 0; i < before.paragraphHashes.length; i++) {
    if (before.paragraphHashes[i] !== after.paragraphHashes[i]) {
      return {
        valid: false,
        error: `第 ${i + 1} 段内容发生变化`,
      };
    }
  }
  return { valid: true };
}

/**
 * 格式规范接口
 */
export interface FormatSpecification {
  heading1?: { font: FontFormat; paragraph: ParagraphFormat };
  heading2?: { font: FontFormat; paragraph: ParagraphFormat };
  heading3?: { font: FontFormat; paragraph: ParagraphFormat };
  bodyText?: { font: FontFormat; paragraph: ParagraphFormat };
  listItem?: { font: FontFormat; paragraph: ParagraphFormat };
}

/**
 * 计算实际行距值（以磅为单位）
 * Word JavaScript API 的 lineSpacing 属性只接受固定磅值
 * 对于多倍行距，需要根据字体大小计算实际磅值
 */
function calculateLineSpacingInPoints(
  lineSpacing: number,
  lineSpacingRule: LineSpacingRule | undefined,
  fontSize: number
): number {
  const rule = lineSpacingRule || "multiple";

  switch (rule) {
    case "multiple":
      // 多倍行距：行距值 * 字体大小 * 1.2（Word 默认单倍行距约为字体大小的 1.2 倍）
      // 例如：1.5 倍行距，12pt 字体 = 1.5 * 12 * 1.2 = 21.6pt
      return lineSpacing * fontSize * 1.2;
    case "exactly":
    case "atLeast":
      // 固定值或最小值：直接使用磅值
      return lineSpacing;
    default:
      return lineSpacing * fontSize * 1.2;
  }
}

/**
 * 安全的格式应用 - 只修改格式属性，不修改内容
 */
export async function applyFormatToParagraphsSafe(
  formatSpec: FormatSpecification,
  paragraphIndices: number[],
  paragraphType: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem"
): Promise<void> {
  const beforeCheckpoint = await createContentCheckpoint();

  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const format = formatSpec[paragraphType];
    if (!format) return;

    for (const index of paragraphIndices) {
      if (index >= paragraphs.items.length) continue;

      const para = paragraphs.items[index];

      // 只修改格式属性
      if (format.font.name) para.font.name = format.font.name;
      if (format.font.size) para.font.size = format.font.size;
      if (format.font.bold !== undefined) para.font.bold = format.font.bold;
      if (format.font.italic !== undefined) para.font.italic = format.font.italic;
      if (format.font.color) para.font.color = format.font.color;

      if (format.paragraph.alignment) {
        para.alignment = format.paragraph.alignment as Word.Alignment;
      }
      if (format.paragraph.lineSpacing !== undefined) {
        // 根据行距规则计算实际行距值
        const fontSize = format.font.size || 12; // 默认 12pt
        const actualLineSpacing = calculateLineSpacingInPoints(
          format.paragraph.lineSpacing,
          format.paragraph.lineSpacingRule,
          fontSize
        );
        para.lineSpacing = actualLineSpacing;
      }
      if (format.paragraph.firstLineIndent !== undefined) {
        para.firstLineIndent = format.paragraph.firstLineIndent;
      }
      if (format.paragraph.leftIndent !== undefined) {
        para.leftIndent = format.paragraph.leftIndent;
      }
      if (format.paragraph.rightIndent !== undefined) {
        para.rightIndent = format.paragraph.rightIndent;
      }
      if (format.paragraph.spaceBefore !== undefined) {
        para.spaceBefore = format.paragraph.spaceBefore;
      }
      if (format.paragraph.spaceAfter !== undefined) {
        para.spaceAfter = format.paragraph.spaceAfter;
      }
    }

    await context.sync();
  });

  const afterCheckpoint = await createContentCheckpoint();
  const result = verifyContentIntegrity(beforeCheckpoint, afterCheckpoint);

  if (!result.valid) {
    throw new Error(`内容完整性校验失败: ${result.error}`);
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

  for (let i = 0; i < total; i += batchSize) {
    const batch = paragraphsToFormat.slice(i, i + batchSize);

    // 按类型分组
    const byType: Record<string, number[]> = {};
    for (const item of batch) {
      if (!byType[item.type]) {
        byType[item.type] = [];
      }
      byType[item.type].push(item.index);
    }

    // 应用每种类型的格式
    for (const [type, indices] of Object.entries(byType)) {
      await applyFormatToParagraphsSafe(
        formatSpec,
        indices,
        type as "heading1" | "heading2" | "heading3" | "bodyText" | "listItem"
      );
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }
  }
}

