import type { ComponentType } from "react";
import {
  Sparkle24Regular,
  TextEditStyle24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
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
