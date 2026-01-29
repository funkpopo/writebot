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
  // 如果没有配置 API 密钥，返回模拟响应
  if (!config.apiKey) {
    return simulateAIResponse(prompt, systemPrompt);
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
 * 模拟 AI 响应（用于演示和测试）
 */
function simulateAIResponse(prompt: string, systemPrompt?: string): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (systemPrompt?.includes("润色")) {
        resolve(`[润色后的文本]\n${prompt}\n\n（这是模拟响应，请配置 AI API 密钥以获取真实结果）`);
      } else if (systemPrompt?.includes("翻译")) {
        resolve(`[翻译结果]\n${prompt}\n\n（这是模拟响应，请配置 AI API 密钥以获取真实结果）`);
      } else if (systemPrompt?.includes("语法")) {
        resolve(`[语法检查结果]\n文本看起来没有明显的语法错误。\n\n（这是模拟响应，请配置 AI API 密钥以获取真实结果）`);
      } else if (systemPrompt?.includes("摘要")) {
        resolve(`[摘要]\n这是一段关于"${prompt.substring(0, 50)}..."的内容摘要。\n\n（这是模拟响应，请配置 AI API 密钥以获取真实结果）`);
      } else if (systemPrompt?.includes("续写")) {
        resolve(`${prompt}\n\n[续写内容]\n这里是续写的内容...\n\n（这是模拟响应，请配置 AI API 密钥以获取真实结果）`);
      } else {
        resolve(`[AI 生成内容]\n基于您的输入"${prompt.substring(0, 30)}..."生成的内容。\n\n（这是模拟响应，请配置 AI API 密钥以获取真实结果）`);
      }
    }, 1000);
  });
}

/**
 * 文本润色
 */
export async function polishText(text: string): Promise<string> {
  const systemPrompt = "你是一个专业的文本润色助手。请对用户提供的文本进行润色，使其更加流畅、专业，同时保持原意。只返回润色后的文本，不要添加解释。";
  return callAI(`请润色以下文本：\n\n${text}`, systemPrompt);
}

/**
 * 翻译文本（中英互译）
 */
export async function translateText(text: string): Promise<string> {
  const systemPrompt = "你是一个专业的翻译助手。如果输入是中文，请翻译成英文；如果输入是英文，请翻译成中文。只返回翻译结果，不要添加解释。";
  return callAI(`请翻译以下文本：\n\n${text}`, systemPrompt);
}

/**
 * 语法检查
 */
export async function checkGrammar(text: string): Promise<string> {
  const systemPrompt = "你是一个专业的语法检查助手。请检查用户提供的文本中的语法错误，并提供修正后的版本。如果有错误，请指出错误并给出修正；如果没有错误，请说明文本语法正确。";
  return callAI(`请检查以下文本的语法：\n\n${text}`, systemPrompt);
}

/**
 * 生成摘要
 */
export async function summarizeText(text: string): Promise<string> {
  const systemPrompt = "你是一个专业的文本摘要助手。请为用户提供的文本生成简洁的摘要，抓住主要观点和关键信息。";
  return callAI(`请为以下文本生成摘要：\n\n${text}`, systemPrompt);
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
  const systemPrompt = `你是一个专业的写作续写助手。请以${styleDesc}的风格续写用户提供的文本，保持内容连贯和风格一致。`;
  return callAI(`请续写以下文本：\n\n${text}`, systemPrompt);
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
