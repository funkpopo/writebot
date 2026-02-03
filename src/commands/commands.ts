/* global Office, Word */

import {
  polishText as aiPolishText,
  checkGrammar as aiCheckGrammar,
  translateText as aiTranslateText,
  continueWriting as aiContinueWriting,
  summarizeText as aiSummarizeText,
  setAIConfig,
} from "../utils/aiService";
import { loadSettings, saveContextMenuResult } from "../utils/storageService";
import {
  SelectionFormat,
  getSelectedTextWithFormat,
  replaceSelectedTextWithFormat,
  deleteSelection,
  insertHtml,
  insertText,
  insertTable,
  replaceSelectionWithHtml,
} from "../utils/wordApi";
import { parseMarkdownWithTables } from "../utils/textSanitizer";
import { looksLikeMarkdown, markdownToWordHtml } from "../utils/markdownRenderer";

Office.onReady(() => {
  // 初始化时加载保存的设置
  const settings = loadSettings();
  setAIConfig(settings);
});

/**
 * 获取选中的文本及格式
 */
async function getSelectedTextAndFormat(): Promise<{
  text: string;
  format: SelectionFormat;
}> {
  return getSelectedTextWithFormat();
}

/**
 * 替换选中的文本并保留格式
 */
async function replaceSelectedTextKeepFormat(
  newText: string,
  format: SelectionFormat
): Promise<void> {
  await replaceSelectedTextWithFormat(newText, format);
}

async function replaceSelectedContentWithMarkdown(rawText: string): Promise<void> {
  const parsed = parseMarkdownWithTables(rawText);
  const shouldRenderMarkdown = parsed.hasTable || looksLikeMarkdown(rawText);

  if (!shouldRenderMarkdown) {
    // Fallback: treat it as plain text; caller can preserve format.
    await replaceSelectedTextWithFormat(rawText, (await getSelectedTextWithFormat()).format);
    return;
  }

  if (parsed.hasTable) {
    await deleteSelection();
    for (const segment of parsed.segments) {
      if (segment.type === "text") {
        if (segment.content.trim()) {
          await insertHtml(markdownToWordHtml(segment.content));
        }
        continue;
      }

      await insertTable({ headers: segment.data.headers, rows: segment.data.rows });
      await insertText("\n");
    }
    return;
  }

  await replaceSelectionWithHtml(markdownToWordHtml(rawText));
}

/**
 * 在选中文本后插入内容
 */
async function insertAfterSelection(text: string): Promise<void> {
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(text, Word.InsertLocation.after);
    await context.sync();
  });
}

/**
 * 润色文本命令
 */
async function polishText(event: Office.AddinCommands.Event): Promise<void> {
  try {
    const { text, format } = await getSelectedTextAndFormat();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiPolishText(text);
    // If the model outputs Markdown, render it into Word formatting; otherwise preserve selection format.
    const parsed = parseMarkdownWithTables(result.content);
    if (parsed.hasTable || looksLikeMarkdown(result.content)) {
      await replaceSelectedContentWithMarkdown(result.content);
    } else {
      await replaceSelectedTextKeepFormat(result.content, format);
    }
    // 保存结果到 localStorage 以便侧边栏显示
    await saveContextMenuResult({
      id: Date.now().toString(),
      originalText: text,
      resultText: result.content,
      thinking: result.thinking,
      action: "polish",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("润色文本失败:", error);
  }
  event.completed();
}

/**
 * 语法检查命令
 */
async function checkGrammar(event: Office.AddinCommands.Event): Promise<void> {
  try {
    const { text, format } = await getSelectedTextAndFormat();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiCheckGrammar(text);
    const parsed = parseMarkdownWithTables(result.content);
    if (parsed.hasTable || looksLikeMarkdown(result.content)) {
      await replaceSelectedContentWithMarkdown(result.content);
    } else {
      await replaceSelectedTextKeepFormat(result.content, format);
    }
    await saveContextMenuResult({
      id: Date.now().toString(),
      originalText: text,
      resultText: result.content,
      thinking: result.thinking,
      action: "grammar",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("语法检查失败:", error);
  }
  event.completed();
}

/**
 * 翻译文本命令
 */
async function translateText(event: Office.AddinCommands.Event): Promise<void> {
  try {
    const { text, format } = await getSelectedTextAndFormat();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiTranslateText(text);
    const parsed = parseMarkdownWithTables(result.content);
    if (parsed.hasTable || looksLikeMarkdown(result.content)) {
      await replaceSelectedContentWithMarkdown(result.content);
    } else {
      await replaceSelectedTextKeepFormat(result.content, format);
    }
    await saveContextMenuResult({
      id: Date.now().toString(),
      originalText: text,
      resultText: result.content,
      thinking: result.thinking,
      action: "translate",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("翻译失败:", error);
  }
  event.completed();
}

/**
 * AI续写命令
 */
async function continueWriting(event: Office.AddinCommands.Event): Promise<void> {
  try {
    const { text, format } = await getSelectedTextAndFormat();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiContinueWriting(text, "professional");
    const parsed = parseMarkdownWithTables(result.content);
    if (parsed.hasTable || looksLikeMarkdown(result.content)) {
      await replaceSelectedContentWithMarkdown(result.content);
    } else {
      await replaceSelectedTextKeepFormat(result.content, format);
    }
    await saveContextMenuResult({
      id: Date.now().toString(),
      originalText: text,
      resultText: result.content,
      thinking: result.thinking,
      action: "continue",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("续写失败:", error);
  }
  event.completed();
}

/**
 * 总结文本命令
 */
async function summarizeText(event: Office.AddinCommands.Event): Promise<void> {
  try {
    const { text, format } = await getSelectedTextAndFormat();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiSummarizeText(text);
    const parsed = parseMarkdownWithTables(result.content);
    if (parsed.hasTable || looksLikeMarkdown(result.content)) {
      await replaceSelectedContentWithMarkdown(result.content);
    } else {
      await replaceSelectedTextKeepFormat(result.content, format);
    }
    await saveContextMenuResult({
      id: Date.now().toString(),
      originalText: text,
      resultText: result.content,
      thinking: result.thinking,
      action: "summarize",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("总结失败:", error);
  }
  event.completed();
}

/**
 * 显示任务窗格
 */
function showTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.showAsTaskpane();
  event.completed();
}

// 注册命令函数到全局作用域
(globalThis as Record<string, unknown>).polishText = polishText;
(globalThis as Record<string, unknown>).checkGrammar = checkGrammar;
(globalThis as Record<string, unknown>).translateText = translateText;
(globalThis as Record<string, unknown>).continueWriting = continueWriting;
(globalThis as Record<string, unknown>).summarizeText = summarizeText;
(globalThis as Record<string, unknown>).showTaskpane = showTaskpane;
