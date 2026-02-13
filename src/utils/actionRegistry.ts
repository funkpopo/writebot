import type { PromptKey } from "./promptService";

export type ActionKind = "simple" | "agent";

export interface ActionDefinition {
  id: string;
  label: string;
  kind: ActionKind;
  promptKey: PromptKey;
  /**
   * Optional tool whitelist for agent actions.
   * - undefined / []: all tools
   * - non-empty: only tools in this list
   */
  toolNames?: string[];
  requiresStyle?: boolean;
  inputPlaceholder?: string;
  contextMenu?: {
    commandName: string;
    style?: string;
  };
}

export const DEFAULT_INPUT_PLACEHOLDER = "输入文本或从文档中选择内容...";

export const ACTION_REGISTRY = [
  {
    id: "agent",
    label: "智能需求",
    kind: "agent",
    promptKey: "assistant_agent",
    toolNames: undefined as string[] | undefined,
    requiresStyle: false,
    inputPlaceholder: "描述你的需求，AI 会自动调用工具...",
    contextMenu: undefined,
  },
  {
    id: "polish",
    label: "润色",
    kind: "simple",
    promptKey: "polish",
    toolNames: undefined as string[] | undefined,
    requiresStyle: false,
    inputPlaceholder: undefined,
    contextMenu: { commandName: "polishText", style: undefined },
  },
  {
    id: "translate",
    label: "翻译",
    kind: "simple",
    promptKey: "translate",
    toolNames: undefined as string[] | undefined,
    requiresStyle: false,
    inputPlaceholder: undefined,
    contextMenu: { commandName: "translateText", style: undefined },
  },
  {
    id: "grammar",
    label: "语法检查",
    kind: "simple",
    promptKey: "grammar",
    toolNames: undefined as string[] | undefined,
    requiresStyle: false,
    inputPlaceholder: undefined,
    contextMenu: { commandName: "checkGrammar", style: undefined },
  },
  {
    id: "summarize",
    label: "生成摘要",
    kind: "simple",
    promptKey: "summarize",
    toolNames: undefined as string[] | undefined,
    requiresStyle: false,
    inputPlaceholder: undefined,
    contextMenu: { commandName: "summarizeText", style: undefined },
  },
  {
    id: "continue",
    label: "续写内容",
    kind: "simple",
    promptKey: "continue",
    toolNames: undefined as string[] | undefined,
    requiresStyle: true,
    inputPlaceholder: undefined,
    contextMenu: { commandName: "continueWriting", style: "professional" },
  },
  {
    id: "generate",
    label: "生成内容",
    kind: "simple",
    promptKey: "generate",
    toolNames: undefined as string[] | undefined,
    requiresStyle: true,
    inputPlaceholder: undefined,
    contextMenu: undefined,
  },
] as const satisfies readonly ActionDefinition[];

export type ActionDefinitionEntry = (typeof ACTION_REGISTRY)[number];
export type ActionId = ActionDefinitionEntry["id"];
export type ActionType = ActionId | null;
export type SimpleActionDefinition = Extract<ActionDefinitionEntry, { kind: "simple" }>;
export type AgentActionDefinition = Extract<ActionDefinitionEntry, { kind: "agent" }>;
export type ContextMenuActionDefinition = SimpleActionDefinition & {
  contextMenu: NonNullable<SimpleActionDefinition["contextMenu"]>;
};
export type ContextMenuActionId = ContextMenuActionDefinition["id"];

const ACTION_BY_ID = new Map<ActionId, ActionDefinitionEntry>(
  ACTION_REGISTRY.map((action) => [action.id, action] as const)
);

export const SIMPLE_ACTIONS: readonly SimpleActionDefinition[] = ACTION_REGISTRY.filter(
  (action): action is SimpleActionDefinition => action.kind === "simple"
);

export const AGENT_ACTIONS: readonly AgentActionDefinition[] = ACTION_REGISTRY.filter(
  (action): action is AgentActionDefinition => action.kind === "agent"
);

export const CONTEXT_MENU_ACTIONS: readonly ContextMenuActionDefinition[] = SIMPLE_ACTIONS.filter(
  (action): action is ContextMenuActionDefinition => Boolean(action.contextMenu)
);

export function getActionDef(id: string | null | undefined): ActionDefinitionEntry | undefined {
  if (!id) return undefined;
  return ACTION_BY_ID.get(id as ActionId);
}

export function getActionLabel(id: string | null | undefined): string {
  return getActionDef(id)?.label ?? "";
}

export function isActionId(id: string | null | undefined): id is ActionId {
  if (!id) return false;
  return ACTION_BY_ID.has(id as ActionId);
}
