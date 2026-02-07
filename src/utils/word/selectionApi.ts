/* global Word, Office */

import { FontFormat, ParagraphFormat, SelectionFormat } from "./types";

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
  format: SelectionFormat;
}> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraphs = selection.paragraphs;

    selection.load("text");
    selection.font.load(
      "name, size, bold, italic, underline, strikeThrough, color, highlightColor"
    );

    paragraphs.load("items");
    await context.sync();

    for (const paragraph of paragraphs.items) {
      paragraph.load(
        "alignment, firstLineIndent, leftIndent, rightIndent, lineSpacing, spaceBefore, spaceAfter, style"
      );
      paragraph.font.load(
        "name, size, bold, italic, underline, strikeThrough, color, highlightColor"
      );
    }
    await context.sync();

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

    let paragraphFormat: ParagraphFormat = {};
    const paragraphFormats: { font: FontFormat; paragraph: ParagraphFormat }[] = [];
    if (paragraphs.items.length > 0) {
      for (const paragraph of paragraphs.items) {
        const paraFont: FontFormat = {
          name: paragraph.font.name,
          size: paragraph.font.size,
          bold: paragraph.font.bold,
          italic: paragraph.font.italic,
          underline: paragraph.font.underline as string,
          strikeThrough: paragraph.font.strikeThrough,
          color: paragraph.font.color,
          highlightColor: paragraph.font.highlightColor as string,
        };

        const paraFormat: ParagraphFormat = {
          alignment: paragraph.alignment as string,
          firstLineIndent: paragraph.firstLineIndent,
          leftIndent: paragraph.leftIndent,
          rightIndent: paragraph.rightIndent,
          lineSpacing: paragraph.lineSpacing,
          spaceBefore: paragraph.spaceBefore,
          spaceAfter: paragraph.spaceAfter,
          style: paragraph.style || undefined,
        };

        paragraphFormats.push({
          font: paraFont,
          paragraph: paraFormat,
        });
      }

      paragraphFormat = paragraphFormats[0].paragraph;
    }

    return {
      text: selection.text,
      format: {
        font: fontFormat,
        paragraph: paragraphFormat,
        paragraphs: paragraphFormats.length > 0 ? paragraphFormats : undefined,
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
 * 删除当前选区内容（用于在插入复杂内容前清空选区）
 */
export async function deleteSelection(): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.delete();
    await context.sync();
  });
}
