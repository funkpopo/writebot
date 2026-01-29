/**
 * AI 服务接口
 * 支持 OpenAI、Anthropic、Gemini 三种 API 格式
 * 支持流式输出
 */

import { APIType } from "./storageService";

// 流式回调类型 - 支持思维过程
export type StreamCallback = (chunk: string, done: boolean, isThinking?: boolean) => void;

// AI API 配置
interface AIConfig {
  apiType: APIType;
  apiKey: string;
  apiEndpoint: string;
  model: string;
}

// AI 响应结果（包含思维内容）
export interface AIResponse {
  content: string;
  thinking?: string;
}

// 默认配置（需要用户配置实际的 API 密钥）
const defaultConfig: AIConfig = {
  apiType: "anthropic",
  apiKey: "", // 需要配置
  apiEndpoint: "https://api.anthropic.com/v1/messages",
  model: "claude-3-sonnet-20240229",
};

let config: AIConfig = { ...defaultConfig };

/**
 * 设置 AI 配置
 */
export function setAIConfig(newConfig: Partial<AIConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * 获取当前配置
 */
export function getAIConfig(): AIConfig {
  return { ...config };
}

/**
 * 检查 API 是否已配置
 */
export function isAPIConfigured(): boolean {
  return !!config.apiKey;
}

/**
 * 调用 AI API（根据配置的 API 类型选择对应格式）
 */
async function callAI(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  // 如果没有配置 API 密钥，抛出错误
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 API 密钥");
  }

  switch (config.apiType) {
    case "openai":
      return callOpenAI(prompt, systemPrompt);
    case "anthropic":
      return callAnthropic(prompt, systemPrompt);
    case "gemini":
      return callGemini(prompt, systemPrompt);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 流式调用 AI API（根据配置的 API 类型选择对应格式）
 */
async function callAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 API 密钥");
  }

  switch (config.apiType) {
    case "openai":
      return callOpenAIStream(prompt, systemPrompt, onChunk);
    case "anthropic":
      return callAnthropicStream(prompt, systemPrompt, onChunk);
    case "gemini":
      return callGeminiStream(prompt, systemPrompt, onChunk);
    default:
      throw new Error(`不支持的 API 类型: ${config.apiType}`);
  }
}

/**
 * 调用 OpenAI API
 */
async function callOpenAI(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 131072,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const reasoningContent = data.choices[0].message.reasoning_content;

  // 如果没有 reasoning_content，尝试从内容中提取 <think></think> 标签
  let thinking = reasoningContent;
  let finalContent = content;
  if (!thinking && content) {
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      finalContent = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    }
  }

  return { content: finalContent, thinking };
}

/**
 * 调用 Anthropic API
 */
async function callAnthropic(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const response = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 131072,
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  // Anthropic API 可能返回多个内容块，包括 thinking 和 text 类型
  let thinking = "";
  let content = "";
  for (const block of data.content) {
    if (block.type === "thinking") {
      thinking += block.thinking || "";
    } else if (block.type === "text") {
      content += block.text || "";
    }
  }
  return { content, thinking: thinking || undefined };
}

/**
 * 调用 Gemini API
 */
async function callGemini(prompt: string, systemPrompt?: string): Promise<AIResponse> {
  const contents = [];
  if (systemPrompt) {
    contents.push({
      role: "user",
      parts: [{ text: systemPrompt }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: prompt }],
  });

  // Gemini API endpoint 格式: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
  const endpoint = `${config.apiEndpoint}?key=${config.apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  // Gemini 可能返回带有 thought 标记的 parts
  const parts = data.candidates[0].content.parts;
  let thinking = "";
  let content = "";
  for (const part of parts) {
    if (part.thought) {
      thinking += part.text || "";
    } else {
      content += part.text || "";
    }
  }
  return { content, thinking: thinking || undefined };
}

/**
 * 流式调用 OpenAI API
 * 支持 reasoning_content 字段和 <think></think> 标签格式的思维内容
 */
async function callOpenAIStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 131072,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  // 用于跟踪 <think> 标签状态
  let inThinkTag = false;
  let contentBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // 处理剩余的内容缓冲区
      if (contentBuffer) {
        onChunk(contentBuffer, false, false);
      }
      onChunk("", true);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          // 检测 reasoning_content（思维过程）
          if (delta?.reasoning_content) {
            onChunk(delta.reasoning_content, false, true);
          }
          // 正常内容 - 需要检测 <think></think> 标签
          if (delta?.content) {
            contentBuffer += delta.content;
            // 处理 <think> 标签
            while (contentBuffer.length > 0) {
              if (inThinkTag) {
                // 在 think 标签内，查找结束标签
                const endIndex = contentBuffer.indexOf("</think>");
                if (endIndex !== -1) {
                  // 找到结束标签，输出思维内容
                  const thinkContent = contentBuffer.substring(0, endIndex);
                  if (thinkContent) {
                    onChunk(thinkContent, false, true);
                  }
                  contentBuffer = contentBuffer.substring(endIndex + 8);
                  inThinkTag = false;
                } else {
                  // 没有找到结束标签，检查是否有部分结束标签
                  // 保留可能是部分结束标签的内容
                  const partialEnd = contentBuffer.lastIndexOf("<");
                  if (partialEnd !== -1 && partialEnd > contentBuffer.length - 9) {
                    // 可能是部分 </think> 标签，保留
                    const safeContent = contentBuffer.substring(0, partialEnd);
                    if (safeContent) {
                      onChunk(safeContent, false, true);
                    }
                    contentBuffer = contentBuffer.substring(partialEnd);
                  } else {
                    // 输出所有内容作为思维
                    onChunk(contentBuffer, false, true);
                    contentBuffer = "";
                  }
                  break;
                }
              } else {
                // 不在 think 标签内，查找开始标签
                const startIndex = contentBuffer.indexOf("<think>");
                if (startIndex !== -1) {
                  // 找到开始标签，先输出之前的普通内容
                  const normalContent = contentBuffer.substring(0, startIndex);
                  if (normalContent) {
                    onChunk(normalContent, false, false);
                  }
                  contentBuffer = contentBuffer.substring(startIndex + 7);
                  inThinkTag = true;
                } else {
                  // 没有找到开始标签，检查是否有部分开始标签
                  const partialStart = contentBuffer.lastIndexOf("<");
                  if (partialStart !== -1 && partialStart > contentBuffer.length - 8) {
                    // 可能是部分 <think> 标签，保留
                    const safeContent = contentBuffer.substring(0, partialStart);
                    if (safeContent) {
                      onChunk(safeContent, false, false);
                    }
                    contentBuffer = contentBuffer.substring(partialStart);
                  } else {
                    // 输出所有内容作为普通内容
                    onChunk(contentBuffer, false, false);
                    contentBuffer = "";
                  }
                  break;
                }
              }
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
}

/**
 * 流式调用 Anthropic API
 * 自动检测 extended thinking 的 thinking 内容块
 */
async function callAnthropicStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  const response = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 131072,
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType: "thinking" | "text" | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk("", true);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        // 检测内容块开始，判断是 thinking 还是 text
        if (json.type === "content_block_start") {
          currentBlockType = json.content_block?.type === "thinking" ? "thinking" : "text";
        }
        // 内容块增量
        if (json.type === "content_block_delta") {
          const isThinking = currentBlockType === "thinking";
          // thinking 块使用 thinking 字段，text 块使用 text 字段
          const text = isThinking ? json.delta?.thinking : json.delta?.text;
          if (text) {
            onChunk(text, false, isThinking);
          }
        }
        // 内容块结束
        if (json.type === "content_block_stop") {
          currentBlockType = null;
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
}

/**
 * 流式调用 Gemini API
 */
async function callGeminiStream(
  prompt: string,
  systemPrompt: string | undefined,
  onChunk: StreamCallback
): Promise<void> {
  const contents = [];
  if (systemPrompt) {
    contents.push({
      role: "user",
      parts: [{ text: systemPrompt }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "好的，我会按照您的要求来帮助您。" }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: prompt }],
  });

  // Gemini 流式 API: streamGenerateContent
  const endpoint = config.apiEndpoint.replace(":generateContent", ":streamGenerateContent");
  const streamEndpoint = `${endpoint}?key=${config.apiKey}&alt=sse`;

  const response = await fetch(streamEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk("", true);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const parts = json.candidates?.[0]?.content?.parts;
        if (parts && Array.isArray(parts)) {
          for (const part of parts) {
            // 检测 thought 字段
            if (part.thought) {
              onChunk(part.text || "", false, true);
            } else if (part.text) {
              onChunk(part.text, false, false);
            }
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
}

/**
 * 文本润色
 */
export async function polishText(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的文本润色助手。
要求：
1. 对文本进行润色，使其更加流畅、专业、易读
2. 保持原文的核心意思不变
3. 保持原文的段落结构和格式
4. 直接输出润色后的文本，不要添加任何解释、标签、引号或前缀`;
  return callAI(text, systemPrompt);
}

/**
 * 翻译文本（中英互译）
 */
export async function translateText(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的翻译助手。
要求：
1. 如果输入是中文，翻译成地道的英文
2. 如果输入是英文，翻译成流畅的中文
3. 如果是中英混合，将整体翻译成另一种语言
4. 保持原文的格式和段落结构
5. 直接输出翻译结果，不要添加任何解释、标签、引号或前缀`;
  return callAI(text, systemPrompt);
}

/**
 * 语法检查
 */
export async function checkGrammar(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的语法检查和修正助手。
要求：
1. 检查文本中的语法错误、拼写错误、标点错误
2. 直接输出修正后的完整文本
3. 保持原文的格式和段落结构
4. 如果没有错误，直接返回原文
5. 不要添加任何解释、标签、引号或前缀，只输出修正后的文本`;
  return callAI(text, systemPrompt);
}

/**
 * 生成摘要
 */
export async function summarizeText(text: string): Promise<AIResponse> {
  const systemPrompt = `你是一个专业的文本摘要助手。
要求：
1. 提取文本的核心观点和关键信息
2. 生成简洁、准确的摘要
3. 摘要长度控制在原文的20%-30%
4. 直接输出摘要内容，不要添加"摘要："等前缀或任何解释`;
  return callAI(text, systemPrompt);
}

/**
 * 续写内容
 */
export async function continueWriting(text: string, style: string): Promise<AIResponse> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = `你是一个专业的写作续写助手。
要求：
1. 以${styleDesc}的风格续写文本
2. 保持与原文内容连贯、风格一致
3. 续写长度与原文相当
4. 输出格式：原文 + 续写内容（无缝衔接，不要添加分隔符）
5. 不要添加任何解释或标签`;
  return callAI(text, systemPrompt);
}

/**
 * 生成内容
 */
export async function generateContent(prompt: string, style: string): Promise<AIResponse> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = `你是一个专业的内容生成助手。请以${styleDesc}的风格根据用户的要求生成内容。`;
  return callAI(prompt, systemPrompt);
}

// ==================== 流式版本 ====================

/**
 * 文本润色（流式）
 */
export async function polishTextStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的文本润色助手。
要求：
1. 对文本进行润色，使其更加流畅、专业、易读
2. 保持原文的核心意思不变
3. 保持原文的段落结构和格式
4. 直接输出润色后的文本，不要添加任何解释、标签、引号或前缀`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 翻译文本（流式）
 */
export async function translateTextStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的翻译助手。
要求：
1. 如果输入是中文，翻译成地道的英文
2. 如果输入是英文，翻译成流畅的中文
3. 如果是中英混合，将整体翻译成另一种语言
4. 保持原文的格式和段落结构
5. 直接输出翻译结果，不要添加任何解释、标签、引号或前缀`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 语法检查（流式）
 */
export async function checkGrammarStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的语法检查和修正助手。
要求：
1. 检查文本中的语法错误、拼写错误、标点错误
2. 直接输出修正后的完整文本
3. 保持原文的格式和段落结构
4. 如果没有错误，直接返回原文
5. 不要添加任何解释、标签、引号或前缀，只输出修正后的文本`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 生成摘要（流式）
 */
export async function summarizeTextStream(text: string, onChunk: StreamCallback): Promise<void> {
  const systemPrompt = `你是一个专业的文本摘要助手。
要求：
1. 提取文本的核心观点和关键信息
2. 生成简洁、准确的摘要
3. 摘要长度控制在原文的20%-30%
4. 直接输出摘要内容，不要添加"摘要："等前缀或任何解释`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 续写内容（流式）
 */
export async function continueWritingStream(
  text: string,
  style: string,
  onChunk: StreamCallback
): Promise<void> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = `你是一个专业的写作续写助手。
要求：
1. 以${styleDesc}的风格续写文本
2. 保持与原文内容连贯、风格一致
3. 续写长度与原文相当
4. 输出格式：原文 + 续写内容（无缝衔接，不要添加分隔符）
5. 不要添加任何解释或标签`;
  return callAIStream(text, systemPrompt, onChunk);
}

/**
 * 生成内容（流式）
 */
export async function generateContentStream(
  prompt: string,
  style: string,
  onChunk: StreamCallback
): Promise<void> {
  const styleMap: Record<string, string> = {
    formal: "正式、严谨",
    casual: "轻松、随意",
    professional: "专业、商务",
    creative: "创意、生动",
  };
  const styleDesc = styleMap[style] || "专业";
  const systemPrompt = `你是一个专业的内容生成助手。请以${styleDesc}的风格根据用户的要求生成内容。`;
  return callAIStream(prompt, systemPrompt, onChunk);
}
