import type { ComponentType } from "react";
import {
  Document24Regular,
  DocumentText24Regular,
  Search24Regular,
  Sparkle24Regular,
  TextEditStyle24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
  TextDescription24Regular,
  TextAlignLeft24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";
import type { ActionId } from "./actionRegistry";
import type {
  AssistantModuleDefinition,
  AssistantModuleIconKey,
} from "./assistantModuleService";

export const ACTION_ICONS: Record<ActionId, ComponentType> = {
  agent: Sparkle24Regular,
  polish: TextEditStyle24Regular,
  translate: Translate24Regular,
  grammar: TextGrammarCheckmark24Regular,
  summarize: TextBulletListSquare24Regular,
  continue: TextExpand24Regular,
  generate: Wand24Regular,
};

const MODULE_ICON_BY_KEY: Record<AssistantModuleIconKey, ComponentType> = {
  agent: Sparkle24Regular,
  polish: TextEditStyle24Regular,
  translate: Translate24Regular,
  grammar: TextGrammarCheckmark24Regular,
  summarize: TextBulletListSquare24Regular,
  continue: TextExpand24Regular,
  generate: Wand24Regular,
  description: TextDescription24Regular,
  format: TextAlignLeft24Regular,
  settings: Settings24Regular,
  search: Search24Regular,
  document: Document24Regular,
  document_text: DocumentText24Regular,
  book: Wand24Regular,
  notebook: Wand24Regular,
  note: Wand24Regular,
  clipboard_task: Wand24Regular,
  pen: TextEditStyle24Regular,
  edit: TextEditStyle24Regular,
  compose: Wand24Regular,
  chat: TextDescription24Regular,
  chat_sparkle: Sparkle24Regular,
  code: DocumentText24Regular,
  data: DocumentText24Regular,
  table: DocumentText24Regular,
  target: Wand24Regular,
  lightbulb: Wand24Regular,
  brain: Sparkle24Regular,
  apps: Wand24Regular,
  rocket: Wand24Regular,
  globe: Translate24Regular,
  people: TextDescription24Regular,
  mail: TextDescription24Regular,
  calendar: TextDescription24Regular,
  image: Document24Regular,
  camera: Document24Regular,
  folder: Document24Regular,
  home: Document24Regular,
  star: Sparkle24Regular,
  heart: Sparkle24Regular,
  tag: TextDescription24Regular,
  receipt: TextBulletListSquare24Regular,
  tasks: TextBulletListSquare24Regular,
  slide_text: TextDescription24Regular,
  text_bullet: TextBulletListSquare24Regular,
  text_quote: TextDescription24Regular,
  person_lightbulb: Sparkle24Regular,
  scan: TextDescription24Regular,
  custom: Wand24Regular,
};

export function getAssistantModuleIcon(
  module?: Pick<AssistantModuleDefinition, "id" | "kind" | "simpleBehavior" | "iconKey">
): ComponentType | null {
  if (!module) return null;

  if (module.iconKey) {
    return MODULE_ICON_BY_KEY[module.iconKey];
  }

  if (module.id in ACTION_ICONS) {
    return ACTION_ICONS[module.id as ActionId];
  }

  if (module.kind === "workflow") {
    return Sparkle24Regular;
  }

  if (module.simpleBehavior === "translation") {
    return Translate24Regular;
  }

  if (module.simpleBehavior === "style") {
    return Wand24Regular;
  }

  return TextEditStyle24Regular;
}
