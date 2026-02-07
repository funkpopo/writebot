/**
 * AI 服务接口
 * 支持 OpenAI、Anthropic 两种 API 格式
 * 支持流式输出
 *
 * This file is now a thin re-export barrel.
 * All implementation has been moved to ./ai/ sub-modules.
 */

export {
  // Types
  type StreamChunkMeta,
  type StreamCallback,
  type AIResponse,
  type AIResponseWithTools,

  // Config
  setAIConfig,
  getAIConfig,
  isAPIConfigured,
  getAIConfigValidationError,

  // Orchestration
  callAI,
  callAIWithTools,
  callAIWithToolsStream,

  // Public API functions
  polishText,
  translateText,
  checkGrammar,
  summarizeText,
  continueWriting,
  generateContent,

  // Public API functions (streaming)
  polishTextStream,
  translateTextStream,
  checkGrammarStream,
  summarizeTextStream,
  continueWritingStream,
  generateContentStream,

  // Tool continuation internals (for tests)
  __toolCallContinuationInternals,
} from "./ai/index";
