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
 * 段落格式信息接口
 */
export interface ParagraphFormat {
  alignment?: string;
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  lineSpacing?: number;
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
