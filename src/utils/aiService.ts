/**
 * AI 服务接口
 * 支持 OpenAI、Anthropic、Gemini 三种 API 格式
 */

import { APIType } from "./storageService";

// AI API 配置
interface AIConfig {
  apiType: APIType;
  apiKey: string;
  apiEndpoint: string;
  model: string;
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
async function callAI(prompt: string, systemPrompt?: string): Promise<string> {
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
 * 调用 OpenAI API
 */
async function callOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
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
      max_tokens: 2048,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 调用 Anthropic API
 */
async function callAnthropic(prompt: string, systemPrompt?: string): Promise<string> {
  const response = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2048,
      system: systemPrompt || "你是一个专业的写作助手。",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

/**
 * 调用 Gemini API
 */
async function callGemini(prompt: string, systemPrompt?: string): Promise<string> {
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
  return data.candidates[0].content.parts[0].text;
}

/**
 * 文本润色
 */
export async function polishText(text: string): Promise<string> {
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
export async function translateText(text: string): Promise<string> {
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
export async function checkGrammar(text: string): Promise<string> {
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
export async function summarizeText(text: string): Promise<string> {
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
export async function continueWriting(text: string, style: string): Promise<string> {
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
export async function generateContent(prompt: string, style: string): Promise<string> {
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
