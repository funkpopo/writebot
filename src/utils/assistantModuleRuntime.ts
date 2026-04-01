import {
  callAIStream,
  type AIResponse,
  type StreamCallback,
} from "./aiService";
import type { AssistantModuleDefinition } from "./assistantModuleService";
import { getPrompt, renderPromptTemplate } from "./promptService";
import {
  getTranslationTargetLabel,
  normalizeTranslationTargetLanguage,
  type TranslationRequestOptions,
} from "./translationLanguages";

export interface RunAssistantSimpleModuleOptions {
  translation?: TranslationRequestOptions;
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
    : input;

  return callAIStream(promptInput, systemPrompt, onChunk);
}
