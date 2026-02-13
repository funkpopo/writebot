import {
  polishTextStream,
  translateTextStream,
  checkGrammarStream,
  summarizeTextStream,
  continueWritingStream,
  generateContentStream,
  type AIResponse,
  type StreamCallback,
} from "./aiService";
import type { ToolDefinition } from "../types/tools";
import { TOOL_DEFINITIONS } from "./toolDefinitions";
import { getPrompt } from "./promptService";
import { type ActionId, getActionDef } from "./actionRegistry";

type StreamRunnerWithoutStyle = (
  input: string,
  onChunk?: StreamCallback
) => Promise<AIResponse>;

type StreamRunnerWithStyle = (
  input: string,
  style: string,
  onChunk?: StreamCallback
) => Promise<AIResponse>;

export type SimpleRunner = (
  input: string,
  style: string,
  onChunk?: StreamCallback
) => Promise<AIResponse>;

export interface AgentRunnerConfig {
  getTools: () => ToolDefinition[];
  getSystemPrompt: () => string;
}

function fromSimpleStreamRunner(runner: StreamRunnerWithoutStyle): SimpleRunner {
  return (input, _style, onChunk) => runner(input, onChunk);
}

function fromStyledStreamRunner(runner: StreamRunnerWithStyle): SimpleRunner {
  return (input, style, onChunk) => runner(input, style, onChunk);
}

function getAgentTools(action: ActionId): ToolDefinition[] {
  const actionDef = getActionDef(action);
  if (!actionDef || actionDef.kind !== "agent") {
    return TOOL_DEFINITIONS;
  }

  const allowedToolNames = actionDef.toolNames ?? [];
  if (allowedToolNames.length === 0) {
    return TOOL_DEFINITIONS;
  }

  const allowSet = new Set(allowedToolNames);
  return TOOL_DEFINITIONS.filter((tool) => allowSet.has(tool.name));
}

function getAgentSystemPrompt(action: ActionId): string {
  const actionDef = getActionDef(action);
  if (!actionDef) {
    throw new Error(`未找到 action 定义: ${action}`);
  }
  return getPrompt(actionDef.promptKey);
}

export const SIMPLE_RUNNERS: Partial<Record<ActionId, SimpleRunner>> = {
  polish: fromSimpleStreamRunner(polishTextStream),
  translate: fromSimpleStreamRunner(translateTextStream),
  grammar: fromSimpleStreamRunner(checkGrammarStream),
  summarize: fromSimpleStreamRunner(summarizeTextStream),
  continue: fromStyledStreamRunner(continueWritingStream),
  generate: fromStyledStreamRunner(generateContentStream),
};

export const AGENT_RUNNERS: Partial<Record<ActionId, AgentRunnerConfig>> = {
  agent: {
    getTools: () => getAgentTools("agent"),
    getSystemPrompt: () => getAgentSystemPrompt("agent"),
  },
};

export function runSimpleAction(
  action: string,
  input: string,
  style: string,
  onChunk?: StreamCallback
): Promise<AIResponse> {
  const runner = SIMPLE_RUNNERS[action as ActionId];
  if (!runner) {
    throw new Error(`未找到简单任务执行器: ${action}`);
  }
  return runner(input, style, onChunk);
}

export function runAgentAction(action: string): AgentRunnerConfig | undefined {
  return AGENT_RUNNERS[action as ActionId];
}
