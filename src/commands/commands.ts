/* global Office */

import { setAIConfig } from "../utils/aiService";
import { runSimpleAction } from "../utils/actionRunners";
import {
  CONTEXT_MENU_ACTIONS,
  type ContextMenuActionId,
  getActionDef,
} from "../utils/actionRegistry";
import { loadSettings, saveContextMenuResult } from "../utils/storageService";
import { getSelectedTextWithFormat } from "../utils/wordApi";
import { applyAiContentToWord } from "../utils/wordContentApplier";

type OfficeCommandHandler = (event: Office.AddinCommands.Event) => Promise<void>;

Office.onReady(async () => {
  const settings = await loadSettings();
  setAIConfig(settings);
});

async function runSelectionCommand(
  event: Office.AddinCommands.Event,
  action: ContextMenuActionId
): Promise<void> {
  try {
    const actionDef = getActionDef(action);
    if (!actionDef || actionDef.kind !== "simple") {
      throw new Error(`未找到可执行的右键命令 Action: ${action}`);
    }

    const { text } = await getSelectedTextWithFormat();
    if (!text.trim()) {
      return;
    }

    const style = actionDef.contextMenu?.style ?? "professional";
    const result = await runSimpleAction(action, text, style);
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
  } finally {
    event.completed();
  }
}

function buildContextMenuHandlers(): Record<string, OfficeCommandHandler> {
  const handlers: Record<string, OfficeCommandHandler> = {};

  for (const actionDef of CONTEXT_MENU_ACTIONS) {
    const commandName = actionDef.contextMenu.commandName;

    handlers[commandName] = async (event: Office.AddinCommands.Event) => {
      await runSelectionCommand(event, actionDef.id);
    };
  }

  return handlers;
}

function showTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.showAsTaskpane();
  event.completed();
}

const contextMenuHandlers = buildContextMenuHandlers();
for (const [commandName, handler] of Object.entries(contextMenuHandlers)) {
  (globalThis as Record<string, unknown>)[commandName] = handler;
}

(globalThis as Record<string, unknown>).showTaskpane = showTaskpane;
