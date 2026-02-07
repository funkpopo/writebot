/* global Office */

import {
  polishText as aiPolishText,
  checkGrammar as aiCheckGrammar,
  translateText as aiTranslateText,
  continueWriting as aiContinueWriting,
  summarizeText as aiSummarizeText,
  setAIConfig,
  type AIResponse,
} from "../utils/aiService";
import { loadSettings, saveContextMenuResult } from "../utils/storageService";
import { getSelectedTextWithFormat } from "../utils/wordApi";
import { applyAiContentToWord } from "../utils/wordContentApplier";

Office.onReady(async () => {
  const settings = await loadSettings();
  setAIConfig(settings);
});

async function runSelectionCommand(
  event: Office.AddinCommands.Event,
  action: "polish" | "grammar" | "translate" | "continue" | "summarize",
  runner: (text: string) => Promise<AIResponse>
): Promise<void> {
  try {
    const { text } = await getSelectedTextWithFormat();
    if (!text.trim()) {
      event.completed();
      return;
    }

    const result = await runner(text);
    const rawContent = result.rawMarkdown ?? result.content;

    await applyAiContentToWord(rawContent, {
      requireSelection: true,
    });

    await saveContextMenuResult({
      id: Date.now().toString(),
      originalText: text,
      resultText: rawContent,
      thinking: result.thinking,
      action,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`${action} 操作失败:`, error);
  }

  event.completed();
}

async function polishText(event: Office.AddinCommands.Event): Promise<void> {
  return runSelectionCommand(event, "polish", (text) => aiPolishText(text));
}

async function checkGrammar(event: Office.AddinCommands.Event): Promise<void> {
  return runSelectionCommand(event, "grammar", (text) => aiCheckGrammar(text));
}

async function translateText(event: Office.AddinCommands.Event): Promise<void> {
  return runSelectionCommand(event, "translate", (text) => aiTranslateText(text));
}

async function continueWriting(event: Office.AddinCommands.Event): Promise<void> {
  return runSelectionCommand(event, "continue", (text) => aiContinueWriting(text, "professional"));
}

async function summarizeText(event: Office.AddinCommands.Event): Promise<void> {
  return runSelectionCommand(event, "summarize", (text) => aiSummarizeText(text));
}

function showTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.showAsTaskpane();
  event.completed();
}

(globalThis as Record<string, unknown>).polishText = polishText;
(globalThis as Record<string, unknown>).checkGrammar = checkGrammar;
(globalThis as Record<string, unknown>).translateText = translateText;
(globalThis as Record<string, unknown>).continueWriting = continueWriting;
(globalThis as Record<string, unknown>).summarizeText = summarizeText;
(globalThis as Record<string, unknown>).showTaskpane = showTaskpane;
