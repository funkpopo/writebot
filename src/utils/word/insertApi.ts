/* global Word */

import { SelectionFormat, MarkdownHeadingStyleTarget } from "./types";
import { applyFontFormat, applyParagraphFormat, applyHeadingStylesToInsertedRange } from "./utils";

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
  format: SelectionFormat
): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();

    const newRange = selection.insertText(newText, Word.InsertLocation.replace);

    const paragraphs = newRange.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const paragraphFormats =
      format.paragraphs && format.paragraphs.length > 0
        ? format.paragraphs
        : [format];

    for (let i = 0; i < paragraphs.items.length; i++) {
      const paragraph = paragraphs.items[i];
      const paragraphFormat = paragraphFormats[Math.min(i, paragraphFormats.length - 1)];
      applyParagraphFormat(paragraph, paragraphFormat.paragraph);
      applyFontFormat(paragraph.font, paragraphFormat.font);
    }

    await context.sync();
  });
}

/**
 * 在光标位置插入文本并应用当前格式
 */
export async function insertTextWithFormat(
  text: string,
  format: SelectionFormat,
  location: Word.InsertLocation = Word.InsertLocation.end
): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const newRange = selection.insertText(text, location);

    const paragraphs = newRange.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const paragraphFormats =
      format.paragraphs && format.paragraphs.length > 0
        ? format.paragraphs
        : [format];

    for (let i = 0; i < paragraphs.items.length; i++) {
      const paragraph = paragraphs.items[i];
      const paragraphFormat = paragraphFormats[Math.min(i, paragraphFormats.length - 1)];
      applyParagraphFormat(paragraph, paragraphFormat.paragraph);
      applyFontFormat(paragraph.font, paragraphFormat.font);
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
 * 在光标位置插入 HTML（Word 会将 HTML 转换为对应的文档格式）
 */
export async function insertHtml(html: string): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertHtml(html, Word.InsertLocation.end);
    await context.sync();
  });
}

export async function insertHtmlWithHeadingStyles(
  html: string,
  headingTargets: MarkdownHeadingStyleTarget[]
): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const insertedRange = selection.insertHtml(html, Word.InsertLocation.end);
    await context.sync();
    await applyHeadingStylesToInsertedRange(context, insertedRange, headingTargets);
  });
}

export async function replaceSelectionWithHtml(html: string): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertHtml(html, Word.InsertLocation.replace);
    await context.sync();
  });
}

export async function replaceSelectionWithHtmlAndHeadingStyles(
  html: string,
  headingTargets: MarkdownHeadingStyleTarget[]
): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const insertedRange = selection.insertHtml(html, Word.InsertLocation.replace);
    await context.sync();
    await applyHeadingStylesToInsertedRange(context, insertedRange, headingTargets);
  });
}

/**
 * 在文档起始或末尾插入文本
 */
export async function insertTextAtLocation(
  text: string,
  location: "start" | "end"
): Promise<void> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const insertLocation =
      location === "start" ? Word.InsertLocation.start : Word.InsertLocation.end;
    body.insertText(text, insertLocation);
    await context.sync();
  });
}

/**
 * 在文档起始或末尾插入 HTML（Word 会将 HTML 转换为对应的文档格式）
 */
export async function insertHtmlAtLocation(
  html: string,
  location: "start" | "end"
): Promise<void> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const insertLocation =
      location === "start" ? Word.InsertLocation.start : Word.InsertLocation.end;
    body.insertHtml(html, insertLocation);
    await context.sync();
  });
}

export async function insertHtmlAtLocationWithHeadingStyles(
  html: string,
  location: "start" | "end",
  headingTargets: MarkdownHeadingStyleTarget[]
): Promise<void> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const insertLocation =
      location === "start" ? Word.InsertLocation.start : Word.InsertLocation.end;
    const insertedRange = body.insertHtml(html, insertLocation);
    await context.sync();
    await applyHeadingStylesToInsertedRange(context, insertedRange, headingTargets);
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
