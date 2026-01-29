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

Office.onReady(() => {
  // 初始化时加载保存的设置
  const settings = loadSettings();
  setAIConfig(settings);
});

/**
 * 获取选中的文本
 */
async function getSelectedText(): Promise<string> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load("text");
    await context.sync();
    return selection.text;
  });
}

/**
 * 替换选中的文本
 */
async function replaceSelectedText(newText: string): Promise<void> {
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(newText, Word.InsertLocation.replace);
    await context.sync();
  });
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
    const text = await getSelectedText();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiPolishText(text);
    await replaceSelectedText(result);
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
    const text = await getSelectedText();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiCheckGrammar(text);
    await insertAfterSelection("\n\n【语法检查结果】\n" + result);
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
    const text = await getSelectedText();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiTranslateText(text);
    await insertAfterSelection("\n\n【翻译结果】\n" + result);
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
    const text = await getSelectedText();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiContinueWriting(text, "professional");
    await insertAfterSelection(result);
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
    const text = await getSelectedText();
    if (!text.trim()) {
      event.completed();
      return;
    }
    const result = await aiSummarizeText(text);
    await insertAfterSelection("\n\n【摘要】\n" + result);
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
