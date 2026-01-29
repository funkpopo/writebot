/**
 * AI排版服务
 * 提供文档格式分析、统一和应用功能
 */

import { getAIConfig, getAIConfigValidationError } from "./aiService";
import {
  sampleDocumentFormats,
  getAllParagraphsInfo,
  getSectionHeadersFooters,
  applyFormatToParagraphsBatch,
  applyHeaderFooterToAllSections,
  applyColorCorrections,
  DocumentFormatSample,
  ParagraphInfo,
  SectionHeaderFooter,
  FormatSpecification,
  FontFormat,
  ParagraphFormat,
  LineSpacingRule,
  ColorCorrectionItem,
} from "./wordApi";
import { ContextManager } from "./contextManager";

/**
 * 格式分析结果接口
 */
export interface FormatAnalysisResult {
  formatSpec: FormatSpecification;
  inconsistencies: string[];
  suggestions: string[];
  colorAnalysis?: ColorAnalysisItem[];
}

/**
 * 颜色分析项接口
 */
export interface ColorAnalysisItem {
  paragraphIndex: number;
  text: string;
  currentColor: string;
  isReasonable: boolean;
  reason: string;
  suggestedColor: string;
}

/**
 * 页眉页脚统一方案接口
 */
export interface HeaderFooterUnifyPlan {
  shouldUnify: boolean;
  headerText?: string;
  footerText?: string;
  reason: string;
}

/**
 * 进度回调类型
 */
export type ProgressCallback = (
  current: number,
  total: number,
  message: string
) => void;

const contextManager = new ContextManager(4000);

/**
 * 格式分析系统提示词
 */
const FORMAT_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的文档排版助手。分析以下文档格式样本，识别格式不一致的地方，并生成统一的格式规范。

输入：文档格式样本（JSON格式）
输出：统一的格式规范（JSON格式）

要求：
1. 识别标题层级（一级、二级、三级标题）
2. 分析正文段落的字体和段落格式
3. 检测格式不一致的地方
4. 生成合理的统一规范
5. 分析文字颜色的使用情况，检测颜色不一致的问题

行距规范说明：
- lineSpacing: 行距数值
- lineSpacingRule: 行距类型，可选值：
  - "multiple": 多倍行距（lineSpacing 表示倍数，如 1.5 表示 1.5 倍行距）
  - "exactly": 固定值（lineSpacing 表示磅值）
  - "atLeast": 最小值（lineSpacing 表示磅值）
- 常见行距：单倍行距用 lineSpacing: 1, lineSpacingRule: "multiple"；1.5倍行距用 lineSpacing: 1.5, lineSpacingRule: "multiple"

缩进规范说明：
- firstLineIndent: 首行缩进，使用字符数（如 2 表示首行缩进2个字符）
- leftIndent: 左缩进，使用字符数（如 2 表示左缩进2个字符）
- rightIndent: 右缩进，使用字符数（如 0 表示无右缩进）
- 中文正文通常首行缩进2字符，即 firstLineIndent: 2，leftIndent: 0
- 重要：标题（heading1, heading2, heading3）不应有任何缩进，firstLineIndent 和 leftIndent 都应为 0

颜色标识智能分析：
- 不要简单统一所有颜色，而是分析颜色标识的合理性
- 定位使用非标准颜色（非黑色 #000000）的文本内容
- 判断颜色标识是否合理的标准：
  - 合理的颜色标识：关键术语、重要警告、需要强调的数据、专有名词、代码/命令、链接等
  - 不合理的颜色标识：普通描述性文字、连接词、常规句子、无特殊含义的内容
- 对于不合理的颜色标识，建议将其改为标准黑色
- 在 colorAnalysis 数组中报告每个非标准颜色的使用情况

输出格式必须是有效的JSON，结构如下：
{
  "formatSpec": {
    "heading1": { "font": { "name": "字体名", "size": 数字, "bold": true/false }, "paragraph": { "alignment": "对齐方式", "spaceBefore": 数字, "spaceAfter": 数字, "lineSpacing": 数字, "lineSpacingRule": "multiple/exactly/atLeast", "firstLineIndent": 0 } },
    "heading2": { ... },
    "heading3": { ... },
    "bodyText": { "font": { ... }, "paragraph": { "firstLineIndent": 2, ... } },
    "listItem": { ... }
  },
  "inconsistencies": ["不一致问题1", "不一致问题2"],
  "suggestions": ["建议1", "建议2"],
  "colorAnalysis": [
    { "paragraphIndex": 段落索引, "text": "带颜色的文本内容", "currentColor": "#当前颜色", "isReasonable": true/false, "reason": "判断理由", "suggestedColor": "#建议颜色（如不合理则为#000000）" }
  ]
}`;

/**
 * 页眉页脚分析系统提示词
 */
const HEADER_FOOTER_SYSTEM_PROMPT = `你是文档排版助手。分析以下各节的页眉页脚，建议如何统一。

输入：各节页眉页脚内容
输出：统一方案（JSON格式）

要求：
1. 判断是否需要统一
2. 选择最合适的模板
3. 考虑首页和奇偶页的差异

输出格式必须是有效的JSON，结构如下：
{
  "shouldUnify": true/false,
  "headerText": "统一的页眉文本（如果需要）",
  "footerText": "统一的页脚文本（如果需要）",
  "reason": "决策原因"
}`;

/**
 * 调用AI分析格式
 */
async function callAIForFormatAnalysis(
  samples: DocumentFormatSample
): Promise<FormatAnalysisResult> {
  const config = getAIConfig();

  const validationError = getAIConfigValidationError();
  if (validationError) {
    throw new Error(validationError);
  }

  const compressedSamples = {
    headings: contextManager.compressFormatSamples(samples.headings, 30),
    bodyText: contextManager.compressFormatSamples(samples.bodyText, 30),
    lists: contextManager.compressFormatSamples(samples.lists, 30),
    tables: samples.tables,
  };

  const prompt = `请分析以下文档格式样本并生成统一规范：\n${JSON.stringify(compressedSamples, null, 2)}`;

  let endpoint = config.apiEndpoint;
  if (config.apiType === "gemini") {
    const resolvedEndpoint = config.apiEndpoint.includes("{model}")
      ? config.apiEndpoint.replace("{model}", config.model)
      : config.apiEndpoint;
    endpoint = `${resolvedEndpoint}?key=${config.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: getAPIHeaders(config.apiType, config.apiKey),
    body: getAPIBody(config.apiType, config.model, prompt, FORMAT_ANALYSIS_SYSTEM_PROMPT),
  });

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const content = extractContent(config.apiType, data);

  return parseFormatAnalysisResult(content);
}

/**
 * 获取API请求头
 */
function getAPIHeaders(
  apiType: string,
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (apiType) {
    case "openai":
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    case "anthropic":
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      break;
    // gemini 使用 query param
  }

  return headers;
}

/**
 * 获取API请求体
 */
function getAPIBody(
  apiType: string,
  model: string,
  prompt: string,
  systemPrompt: string
): string {
  switch (apiType) {
    case "openai":
      return JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });
    case "anthropic":
      return JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });
    case "gemini":
      return JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "好的，我会按照您的要求来帮助您。" }] },
          { role: "user", parts: [{ text: prompt }] },
        ],
        generationConfig: { maxOutputTokens: 4096 },
      });
    default:
      throw new Error(`不支持的 API 类型: ${apiType}`);
  }
}

/**
 * 从API响应中提取内容
 */
function extractContent(apiType: string, data: unknown): string {
  const d = data as Record<string, unknown>;
  switch (apiType) {
    case "openai": {
      const choices = d.choices as Array<{ message: { content: string } }>;
      return choices?.[0]?.message?.content || "";
    }
    case "anthropic": {
      const content = d.content as Array<{ type: string; text?: string }>;
      return content?.find((c) => c.type === "text")?.text || "";
    }
    case "gemini": {
      const candidates = d.candidates as Array<{
        content: { parts: Array<{ text: string }> };
      }>;
      return candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
    default:
      return "";
  }
}

/**
 * 解析格式分析结果
 */
function parseFormatAnalysisResult(content: string): FormatAnalysisResult {
  // 尝试从内容中提取JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("无法解析AI返回的格式规范");
  }

  try {
    const result = JSON.parse(jsonMatch[0]);
    return {
      formatSpec: result.formatSpec || {},
      inconsistencies: result.inconsistencies || [],
      suggestions: result.suggestions || [],
      colorAnalysis: result.colorAnalysis || [],
    };
  } catch {
    throw new Error("AI返回的格式规范JSON解析失败");
  }
}

/**
 * 调用AI分析页眉页脚
 */
async function callAIForHeaderFooterAnalysis(
  headerFooters: SectionHeaderFooter[]
): Promise<HeaderFooterUnifyPlan> {
  const config = getAIConfig();

  const validationError = getAIConfigValidationError();
  if (validationError) {
    throw new Error(validationError);
  }

  const prompt = `请分析以下各节的页眉页脚并建议统一方案：\n${JSON.stringify(headerFooters, null, 2)}`;

  let endpoint = config.apiEndpoint;
  if (config.apiType === "gemini") {
    const resolvedEndpoint = config.apiEndpoint.includes("{model}")
      ? config.apiEndpoint.replace("{model}", config.model)
      : config.apiEndpoint;
    endpoint = `${resolvedEndpoint}?key=${config.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: getAPIHeaders(config.apiType, config.apiKey),
    body: getAPIBody(config.apiType, config.model, prompt, HEADER_FOOTER_SYSTEM_PROMPT),
  });

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const content = extractContent(config.apiType, data);

  return parseHeaderFooterPlan(content);
}

/**
 * 解析页眉页脚统一方案
 */
function parseHeaderFooterPlan(content: string): HeaderFooterUnifyPlan {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      shouldUnify: false,
      reason: "无法解析AI返回的方案",
    };
  }

  try {
    const result = JSON.parse(jsonMatch[0]);
    return {
      shouldUnify: result.shouldUnify ?? false,
      headerText: result.headerText,
      footerText: result.footerText,
      reason: result.reason || "",
    };
  } catch {
    return {
      shouldUnify: false,
      reason: "AI返回的方案JSON解析失败",
    };
  }
}

// ==================== 导出的主要函数 ====================

/**
 * 分析文档格式并生成统一规范
 */
export async function analyzeAndGenerateFormatSpec(
  onProgress?: ProgressCallback
): Promise<FormatAnalysisResult> {
  onProgress?.(0, 3, "正在采样文档格式...");

  // 1. 采样文档格式
  const samples = await sampleDocumentFormats(5);

  onProgress?.(1, 3, "正在分析格式...");

  // 2. 调用AI分析
  const result = await callAIForFormatAnalysis(samples);

  onProgress?.(3, 3, "分析完成");

  return result;
}

/**
 * 将格式规范应用到整个文档
 */
export async function applyFormatSpecification(
  formatSpec: FormatSpecification,
  onProgress?: ProgressCallback
): Promise<void> {
  onProgress?.(0, 100, "正在获取段落信息...");

  // 1. 获取所有段落信息
  const paragraphs = await getAllParagraphsInfo();

  onProgress?.(10, 100, "正在分类段落...");

  // 2. 根据段落类型分类
  const paragraphsToFormat: Array<{
    index: number;
    type: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem";
  }> = [];

  for (const para of paragraphs) {
    if (!para.text.trim()) continue;

    let type: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem";

    if (para.outlineLevel === 1) {
      type = "heading1";
    } else if (para.outlineLevel === 2) {
      type = "heading2";
    } else if (para.outlineLevel === 3) {
      type = "heading3";
    } else if (para.isListItem) {
      type = "listItem";
    } else {
      type = "bodyText";
    }

    paragraphsToFormat.push({ index: para.index, type });
  }

  onProgress?.(20, 100, "正在应用格式...");

  // 3. 批量应用格式
  await applyFormatToParagraphsBatch(
    formatSpec,
    paragraphsToFormat,
    20,
    (current, total) => {
      const progress = 20 + Math.floor((current / total) * 80);
      onProgress?.(progress, 100, `正在应用格式 (${current}/${total})...`);
    }
  );

  onProgress?.(100, 100, "格式应用完成");
}

/**
 * 分析并统一页眉页脚
 */
export async function unifyHeadersFooters(
  onProgress?: ProgressCallback
): Promise<HeaderFooterUnifyPlan> {
  onProgress?.(0, 3, "正在读取页眉页脚...");

  // 1. 获取所有节的页眉页脚
  const headerFooters = await getSectionHeadersFooters();

  if (headerFooters.length === 0) {
    return {
      shouldUnify: false,
      reason: "文档没有节",
    };
  }

  onProgress?.(1, 3, "正在分析页眉页脚...");

  // 2. 调用AI分析
  const plan = await callAIForHeaderFooterAnalysis(headerFooters);

  onProgress?.(2, 3, "正在应用统一方案...");

  // 3. 如果需要统一，应用方案
  if (plan.shouldUnify) {
    await applyHeaderFooterToAllSections(plan.headerText, plan.footerText);
  }

  onProgress?.(3, 3, "完成");

  return plan;
}

/**
 * 获取文档格式预览信息
 */
export async function getDocumentFormatPreview(): Promise<{
  samples: DocumentFormatSample;
  paragraphCount: number;
  sectionCount: number;
}> {
  const samples = await sampleDocumentFormats(3);
  const paragraphs = await getAllParagraphsInfo();
  const headerFooters = await getSectionHeadersFooters();

  return {
    samples,
    paragraphCount: paragraphs.length,
    sectionCount: headerFooters.length,
  };
}

/**
 * 应用颜色修正
 * 根据AI分析结果，将不合理的颜色标识修正为建议颜色
 */
export async function applyColorAnalysisCorrections(
  colorAnalysis: ColorAnalysisItem[],
  onProgress?: ProgressCallback
): Promise<{ corrected: number; skipped: number }> {
  // 筛选出不合理的颜色标识
  const unreasonableItems = colorAnalysis.filter((item) => !item.isReasonable);

  if (unreasonableItems.length === 0) {
    return { corrected: 0, skipped: colorAnalysis.length };
  }

  onProgress?.(0, unreasonableItems.length, "正在应用颜色修正...");

  const corrections: ColorCorrectionItem[] = unreasonableItems.map((item) => ({
    paragraphIndex: item.paragraphIndex,
    suggestedColor: item.suggestedColor,
  }));

  await applyColorCorrections(corrections, (current, total) => {
    onProgress?.(current, total, `正在修正颜色 (${current}/${total})...`);
  });

  onProgress?.(unreasonableItems.length, unreasonableItems.length, "颜色修正完成");

  return {
    corrected: unreasonableItems.length,
    skipped: colorAnalysis.length - unreasonableItems.length,
  };
}
