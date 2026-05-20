import type {
  AIResponse,
  StreamCallback,
} from "./aiService";
import type { ConversationMessage } from "./conversationManager";
import type { AssistantModuleDefinition } from "./assistantModuleService";
import { getPrompt, renderPromptTemplate } from "./promptService";
import {
  getTranslationTargetLabel,
  normalizeTranslationTargetLanguage,
  type TranslationRequestOptions,
} from "./translationLanguages";

export interface RunAssistantSimpleModuleOptions {
  translation?: TranslationRequestOptions;
  contextMessages?: ConversationMessage[];
}

const STYLE_MAP: Record<string, string> = {
  formal: "正式、严谨",
  casual: "轻松、随意",
  professional: "专业、商务",
  creative: "创意、生动",
};

function buildTranslatePromptInput(
  text: string,
  options?: TranslationRequestOptions
): string {
  const targetLanguage = normalizeTranslationTargetLanguage(options?.targetLanguage);
  if (targetLanguage === "auto_opposite") {
    return text;
  }

  const targetLabel = getTranslationTargetLabel(targetLanguage);
  return [
    `目标语言：${targetLabel}`,
    "请将下列文本完整翻译为目标语言，并仅输出译文：",
    "<<<<TEXT",
    text,
    "TEXT>>>>",
  ].join("\n");
}

function buildContextualPromptInput(input: string, contextMessages?: ConversationMessage[]): string {
  const recentMessages = (contextMessages || [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8);

  if (recentMessages.length === 0) return input;

  const contextText = recentMessages
    .map((message) => {
      const roleLabel = message.role === "user" ? "用户" : "助手";
      return `${roleLabel}：${message.content}`;
    })
    .join("\n\n");

  return [
    "以下是当前任务可参考的最近对话上下文。请只在有助于满足本次需求时使用，不要复述无关内容。",
    "<<<<CONTEXT",
    contextText,
    "CONTEXT>>>>",
    "",
    "本次用户需求：",
    "<<<<USER_REQUEST",
    input,
    "USER_REQUEST>>>>",
  ].join("\n");
}

export async function runAssistantSimpleModule(
  module: AssistantModuleDefinition,
  input: string,
  style: string,
  onChunk?: StreamCallback,
  options?: RunAssistantSimpleModuleOptions
): Promise<AIResponse> {
  if (module.kind !== "simple" || !module.promptKey) {
    throw new Error(`模块 ${module.label} 不是可直接执行的文本处理模块`);
  }

  const basePrompt = getPrompt(module.promptKey);
  const systemPrompt = module.simpleBehavior === "style"
    ? renderPromptTemplate(basePrompt, {
        style: STYLE_MAP[style] || STYLE_MAP.professional,
      })
    : basePrompt;

  const promptInput = module.simpleBehavior === "translation"
    ? buildTranslatePromptInput(input, options?.translation)
    : buildContextualPromptInput(input, options?.contextMessages);

  const { callAIStream } = await import("./aiService");
  return callAIStream(promptInput, systemPrompt, onChunk);
}
