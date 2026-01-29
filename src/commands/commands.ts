/* global Office, Word */

import {
  polishText as aiPolishText,
  checkGrammar as aiCheckGrammar,
  translateText as aiTranslateText,
  continueWriting as aiContinueWriting,
  summarizeText as aiSummarizeText,
  setAIConfig,
} from "../utils/aiService";
import { loadSettings } from "../utils/storageService";
import {
  TextFormat,
  getSelectedTextWithFormat,
  replaceSelectedTextWithFormat,
} from "../utils/wordApi";

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
  format: TextFormat;
}> {
  return getSelectedTextWithFormat();
}

/**
 * 替换选中的文本并保留格式
 */
async function replaceSelectedTextKeepFormat(
  newText: string,
  format: TextFormat
): Promise<void> {
  await replaceSelectedTextWithFormat(newText, format);
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
    await replaceSelectedTextKeepFormat(result, format);
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
    await replaceSelectedTextKeepFormat(result, format);
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
    await replaceSelectedTextKeepFormat(result, format);
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
    await replaceSelectedTextKeepFormat(result, format);
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
    await replaceSelectedTextKeepFormat(result, format);
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
