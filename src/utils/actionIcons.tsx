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

export const ACTION_ICONS: Record<ActionId, ComponentType> = {
  agent: Sparkle24Regular,
  polish: TextEditStyle24Regular,
  translate: Translate24Regular,
  grammar: TextGrammarCheckmark24Regular,
  summarize: TextBulletListSquare24Regular,
  continue: TextExpand24Regular,
  generate: Wand24Regular,
};
