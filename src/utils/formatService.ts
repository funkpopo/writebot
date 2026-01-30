/**
 * AI排版服务
 * 提供文档格式分析、统一和应用功能
 */

import { getAIConfig, getAIConfigValidationError } from "./aiService";
import {
  sampleDocumentFormats,
  getAllParagraphsInfo,
  getSectionHeadersFooters,
  getParagraphIndicesInSelection,
  getParagraphIndicesInCurrentSection,
  getDocumentOoxml,
  restoreDocumentOoxml,
  getDocumentName,
  createContentCheckpoint,
  verifyContentIntegrity,
  applyFormatToParagraphsBatch,
  applyHeaderFooterToAllSections,
  applyColorCorrections,
  DocumentFormatSample,
  ParagraphInfo,
  SectionHeaderFooter,
  FormatSpecification,
  ParagraphFormat,
  FontFormat,
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
  formatMarkAnalysis?: FormatMarkAnalysisItem[];
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
 * 格式标记分析项接口（下划线、斜体、删除线）
 */
export interface FormatMarkAnalysisItem {
  paragraphIndex: number;
  text: string;
  formatType: "underline" | "italic" | "strikethrough";
  isReasonable: boolean;
  reason: string;
  shouldKeep: boolean;
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
 * 作用范围类型
 */
export type FormatScopeType =
  | "selection"
  | "currentSection"
  | "document"
  | "headings"
  | "bodyText"
  | "paragraphs";

/**
 * 作用范围
 */
export interface FormatScope {
  type: FormatScopeType;
  paragraphIndices?: number[];
}

export type IssueSeverity = "info" | "warning" | "error";

export interface IssueItem {
  id: string;
  description: string;
  paragraphIndices: number[];
  severity: IssueSeverity;
  sample?: string;
}

export interface IssueCategory {
  id: string;
  title: string;
  summary: string;
  items: IssueItem[];
}

export type ChangeType =
  | "heading-level-fix"
  | "heading-style"
  | "body-style"
  | "list-style"
  | "heading-numbering"
  | "toc-update"
  | "table-style"
  | "caption-style"
  | "image-alignment"
  | "header-footer-template"
  | "color-correction"
  | "mixed-typography"
  | "punctuation-spacing"
  | "pagination-control"
  | "special-content"
  | "underline-removal"
  | "italic-removal"
  | "strikethrough-removal";

export interface ChangeItem {
  id: string;
  title: string;
  description: string;
  paragraphIndices: number[];
  type: ChangeType;
  preview?: string;
  requiresContentChange?: boolean;
  data?: Record<string, unknown>;
}

export interface ChangePlan {
  items: ChangeItem[];
  formatSpec?: FormatSpecification | null;
}

export interface FormatAnalysisSession {
  scope: FormatScope;
  paragraphCount: number;
  sectionCount: number;
  issues: IssueCategory[];
  formatSpec: FormatSpecification | null;
  colorAnalysis: ColorAnalysisItem[];
  formatMarkAnalysis: FormatMarkAnalysisItem[];
  suggestions: string[];
  inconsistencies: string[];
  changePlan: ChangePlan;
}

export interface OperationLogEntry {
  id: string;
  title: string;
  timestamp: number;
  scope: FormatScope;
  itemIds: string[];
  summary: string;
  snapshot: string;
}

export interface HeaderFooterTemplate {
  primaryHeader: string;
  primaryFooter: string;
  firstPageHeader?: string;
  firstPageFooter?: string;
  evenPageHeader?: string;
  evenPageFooter?: string;
  useDifferentFirstPage: boolean;
  useDifferentOddEven: boolean;
  includePageNumber: boolean;
  includeDate: boolean;
  includeDocumentName: boolean;
}

export interface TypographyOptions {
  chineseFont: string;
  englishFont: string;
  enforceSpacing: boolean;
  enforcePunctuation: boolean;
}

/**
 * 进度回调类型
 */
export type ProgressCallback = (
  current: number,
  total: number,
  message: string
) => void;

export interface CancelToken {
  cancelled: boolean;
  abortController?: AbortController;
}

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
6. 分析下划线、斜体、删除线等格式标记的使用情况
7. 确保全文段落间距统一

行距规范说明（重要）：
- lineSpacing: 行距数值
- lineSpacingRule: 行距类型，必须明确指定，可选值：
  - "multiple": 多倍行距（lineSpacing 表示倍数，如 1.5 表示 1.5 倍行距）
  - "exactly": 固定值（lineSpacing 表示磅值）
  - "atLeast": 最小值（lineSpacing 表示磅值）
- 推荐使用多倍行距（lineSpacingRule: "multiple"）以确保一致性
- 常见行距设置：
  - 单倍行距：lineSpacing: 1, lineSpacingRule: "multiple"
  - 1.5倍行距：lineSpacing: 1.5, lineSpacingRule: "multiple"（推荐用于正文）
  - 双倍行距：lineSpacing: 2, lineSpacingRule: "multiple"
- 同类型段落必须使用相同的行距设置

段前段后间距规范说明（重要）：
- spaceBefore: 段前间距（磅值），表示段落前的空白距离
- spaceAfter: 段后间距（磅值），表示段落后的空白距离
- 推荐设置：
  - 一级标题：spaceBefore: 12-18, spaceAfter: 6-12
  - 二级标题：spaceBefore: 12, spaceAfter: 6
  - 三级标题：spaceBefore: 6, spaceAfter: 6
  - 正文段落：spaceBefore: 0, spaceAfter: 0（依靠行距控制间距）
  - 列表项：spaceBefore: 0, spaceAfter: 0
- 同类型段落的段前段后间距必须完全一致
- 避免段前段后间距过大（一般不超过24磅）

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

格式标记智能分析（下划线、斜体、删除线）：
- 不要简单清除所有格式标记，而是分析其使用的合理性
- 判断格式标记是否合理的标准：
  - 合理的下划线：书名、文章标题、需要强调的专有名词、链接文本、法律文书中的关键条款
  - 合理的斜体：外文词汇、学术术语、书名、强调语气、引用内容、变量名
  - 合理的删除线：表示修订内容、已完成的待办事项、价格折扣对比、版本变更说明
  - 不合理的格式标记：普通正文、无特殊含义的内容、装饰性使用
- 在 formatMarkAnalysis 数组中报告每个格式标记的使用情况

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
  ],
  "formatMarkAnalysis": [
    { "paragraphIndex": 段落索引, "text": "带格式标记的文本内容", "formatType": "underline/italic/strikethrough", "isReasonable": true/false, "reason": "判断理由", "shouldKeep": true/false }
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

const operationLogs: OperationLogEntry[] = [];

/**
 * 调用AI分析格式
 */
async function callAIForFormatAnalysis(
  samples: DocumentFormatSample,
  abortSignal?: AbortSignal
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
    signal: abortSignal,
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
    // 验证和修正格式规范中的缩进值
    const formatSpec = sanitizeFormatSpec(result.formatSpec || {});
    return {
      formatSpec,
      inconsistencies: result.inconsistencies || [],
      suggestions: result.suggestions || [],
      colorAnalysis: result.colorAnalysis || [],
      formatMarkAnalysis: result.formatMarkAnalysis || [],
    };
  } catch {
    throw new Error("AI返回的格式规范JSON解析失败");
  }
}

/**
 * 验证格式规范，只处理缩进，行间距和段间距直接使用AI返回的值
 */
function sanitizeFormatSpec(formatSpec: FormatSpecification): FormatSpecification {
  const sanitized: FormatSpecification = {};

  const sanitizeParagraphFormat = (
    format: { font: FontFormat; paragraph: ParagraphFormat } | undefined,
    isHeading: boolean
  ): { font: FontFormat; paragraph: ParagraphFormat } | undefined => {
    if (!format) return undefined;

    const paragraph = { ...format.paragraph };

    // 缩进处理
    if (isHeading) {
      // 标题不应有缩进
      paragraph.firstLineIndent = 0;
      paragraph.leftIndent = 0;
    } else {
      // 限制首行缩进在合理范围内（0-2字符）
      if (paragraph.firstLineIndent !== undefined) {
        paragraph.firstLineIndent = Math.max(0, Math.min(paragraph.firstLineIndent, 2));
      }
      // 限制左缩进在合理范围内（0-2字符）
      if (paragraph.leftIndent !== undefined) {
        paragraph.leftIndent = Math.max(0, Math.min(paragraph.leftIndent, 2));
      }
    }

    // 行距和段间距直接使用AI返回的值，不做范围限制
    // paragraph.lineSpacing, paragraph.lineSpacingRule, paragraph.spaceBefore, paragraph.spaceAfter 保持原值

    return {
      font: format.font,
      paragraph,
    };
  };

  sanitized.heading1 = sanitizeParagraphFormat(formatSpec.heading1, true);
  sanitized.heading2 = sanitizeParagraphFormat(formatSpec.heading2, true);
  sanitized.heading3 = sanitizeParagraphFormat(formatSpec.heading3, true);
  sanitized.bodyText = sanitizeParagraphFormat(formatSpec.bodyText, false);
  sanitized.listItem = sanitizeParagraphFormat(formatSpec.listItem, false);

  return sanitized;
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
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal
): Promise<FormatAnalysisResult> {
  onProgress?.(0, 3, "正在采样文档格式...");

  // 1. 采样文档格式
  const samples = await sampleDocumentFormats(5);

  if (abortSignal?.aborted) {
    throw new Error("操作已取消");
  }

  onProgress?.(1, 3, "正在分析格式...");

  // 2. 调用AI分析
  const result = await callAIForFormatAnalysis(samples, abortSignal);

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

// ==================== 新增分析与优化流程 ====================

const defaultTypographyOptions: TypographyOptions = {
  chineseFont: "宋体",
  englishFont: "Times New Roman",
  enforceSpacing: true,
  enforcePunctuation: true,
};

const defaultHeaderFooterTemplate: HeaderFooterTemplate = {
  primaryHeader: "{documentName}",
  primaryFooter: "第 {pageNumber} 页",
  useDifferentFirstPage: false,
  useDifferentOddEven: false,
  includePageNumber: true,
  includeDate: false,
  includeDocumentName: true,
};

const chineseRegex = /[\u4e00-\u9fff]/;
const englishRegex = /[A-Za-z]/;

function uniqueSorted(indices: number[]): number[] {
  return Array.from(new Set(indices)).sort((a, b) => a - b);
}

function filterParagraphsByIndices(
  paragraphs: ParagraphInfo[],
  indices: number[]
): ParagraphInfo[] {
  if (indices.length === 0) return [];
  const indexSet = new Set(indices);
  return paragraphs.filter((p) => indexSet.has(p.index));
}

function getDominantParagraph(paragraphs: ParagraphInfo[]): ParagraphInfo | null {
  if (paragraphs.length === 0) return null;
  const counts = new Map<string, { count: number; sample: ParagraphInfo }>();
  for (const para of paragraphs) {
    const signature = JSON.stringify({
      name: para.font.name || "",
      size: para.font.size || 0,
      bold: para.font.bold ? 1 : 0,
      alignment: para.paragraph.alignment || "",
      firstLineIndent: Math.round((para.paragraph.firstLineIndent || 0) * 10) / 10,
      leftIndent: Math.round((para.paragraph.leftIndent || 0) * 10) / 10,
      lineSpacing: Math.round((para.paragraph.lineSpacing || 0) * 10) / 10,
      lineSpacingRule: para.paragraph.lineSpacingRule || "exactly",
      spaceBefore: Math.round((para.paragraph.spaceBefore || 0) * 10) / 10,
      spaceAfter: Math.round((para.paragraph.spaceAfter || 0) * 10) / 10,
    });
    const existing = counts.get(signature);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(signature, { count: 1, sample: para });
    }
  }
  let best: { count: number; sample: ParagraphInfo } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  return best?.sample ?? null;
}
function stripHeadingNumber(text: string): string {
  return text.replace(/^\s*\d+(\.\d+)*\s+/, "").trim();
}

function buildHeadingNumberingMap(
  headings: ParagraphInfo[]
): Array<{ index: number; newText: string }> {
  const counters = [0, 0, 0, 0, 0, 0];
  const changes: Array<{ index: number; newText: string }> = [];

  for (const heading of headings) {
    const level = heading.outlineLevel || 1;
    if (level < 1 || level > counters.length) continue;

    counters[level - 1] += 1;
    for (let i = level; i < counters.length; i++) {
      counters[i] = 0;
    }

    const number = counters.slice(0, level).filter((n) => n > 0).join(".");
    const cleanText = stripHeadingNumber(heading.text);
    const newText = `${number} ${cleanText}`.trim();

    if (newText !== heading.text.trim()) {
      changes.push({ index: heading.index, newText });
    }
  }

  return changes;
}

function detectHeadingLevelFixes(
  headings: ParagraphInfo[]
): Array<{ index: number; level: number }> {
  const fixes: Array<{ index: number; level: number }> = [];
  let lastLevel = 0;
  for (const heading of headings) {
    const level = heading.outlineLevel || 1;
    if (lastLevel === 0) {
      lastLevel = level;
      continue;
    }
    if (level > lastLevel + 1) {
      const newLevel = lastLevel + 1;
      fixes.push({ index: heading.index, level: newLevel });
      lastLevel = newLevel;
    } else {
      lastLevel = level;
    }
  }
  return fixes;
}

function formatMismatch(
  para: ParagraphInfo,
  reference: ParagraphInfo
): boolean {
  const fontName = para.font.name || "";
  const refName = reference.font.name || "";
  const fontSize = para.font.size || 0;
  const refSize = reference.font.size || 0;
  const bold = para.font.bold ?? false;
  const refBold = reference.font.bold ?? false;
  const align = para.paragraph.alignment || "";
  const refAlign = reference.paragraph.alignment || "";
  const spaceBefore = para.paragraph.spaceBefore || 0;
  const refSpaceBefore = reference.paragraph.spaceBefore || 0;
  const spaceAfter = para.paragraph.spaceAfter || 0;
  const refSpaceAfter = reference.paragraph.spaceAfter || 0;
  const lineSpacing = para.paragraph.lineSpacing || 0;
  const refLineSpacing = reference.paragraph.lineSpacing || 0;
  const firstIndent = para.paragraph.firstLineIndent || 0;
  const refFirstIndent = reference.paragraph.firstLineIndent || 0;

  const numberDiff = (a: number, b: number) => Math.abs(a - b) > 0.5;

  return (
    fontName !== refName ||
    numberDiff(fontSize, refSize) ||
    bold !== refBold ||
    align !== refAlign ||
    numberDiff(spaceBefore, refSpaceBefore) ||
    numberDiff(spaceAfter, refSpaceAfter) ||
    numberDiff(lineSpacing, refLineSpacing) ||
    numberDiff(firstIndent, refFirstIndent)
  );
}

function detectHeadingConsistencyIssues(
  headings: ParagraphInfo[],
  level: number
): IssueItem[] {
  const levelHeadings = headings.filter((p) => p.outlineLevel === level);
  const reference = getDominantParagraph(levelHeadings);
  if (!reference) return [];
  const inconsistent = levelHeadings.filter((p) => formatMismatch(p, reference));
  if (inconsistent.length === 0) return [];
  return [
    {
      id: `heading-consistency-${level}`,
      description: `${level}级标题样式不一致`,
      paragraphIndices: inconsistent.map((p) => p.index),
      severity: "warning",
      sample: inconsistent[0]?.text?.slice(0, 40),
    },
  ];
}

function detectBodyConsistencyIssues(body: ParagraphInfo[]): IssueItem[] {
  const reference = getDominantParagraph(body);
  if (!reference) return [];
  const inconsistent = body.filter((p) => formatMismatch(p, reference));
  if (inconsistent.length === 0) return [];
  return [
    {
      id: "body-consistency",
      description: "正文样式不一致",
      paragraphIndices: inconsistent.map((p) => p.index),
      severity: "warning",
      sample: inconsistent[0]?.text?.slice(0, 40),
    },
  ];
}

function detectListConsistencyIssues(listItems: ParagraphInfo[]): IssueItem[] {
  if (listItems.length === 0) return [];
  const reference = getDominantParagraph(listItems);
  if (!reference) return [];
  const inconsistent = listItems.filter((p) => formatMismatch(p, reference));
  const issues: IssueItem[] = [];
  if (inconsistent.length > 0) {
    issues.push({
      id: "list-consistency",
      description: "列表缩进或样式不一致",
      paragraphIndices: inconsistent.map((p) => p.index),
      severity: "warning",
      sample: inconsistent[0]?.text?.slice(0, 40),
    });
  }
  return issues;
}

function detectHierarchyIssues(headings: ParagraphInfo[]): IssueItem[] {
  const issues: IssueItem[] = [];
  let lastLevel = 0;
  for (const heading of headings) {
    const level = heading.outlineLevel || 1;
    if (lastLevel > 0 && level > lastLevel + 1) {
      issues.push({
        id: `heading-skip-${heading.index}`,
        description: "标题跳级",
        paragraphIndices: [heading.index],
        severity: "warning",
        sample: heading.text.slice(0, 40),
      });
    }
    const text = heading.text || "";
    if (text.length > 60 || /[。！？；]/.test(text)) {
      issues.push({
        id: `heading-suspect-${heading.index}`,
        description: "疑似正文误设为标题",
        paragraphIndices: [heading.index],
        severity: "info",
        sample: text.slice(0, 40),
      });
    }
    lastLevel = level;
  }
  return issues;
}

function detectListInBodyIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const issues: IssueItem[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (!para.isListItem) continue;
    const prev = paragraphs[i - 1];
    const next = paragraphs[i + 1];
    const isIsolated = (!prev || !prev.isListItem) && (!next || !next.isListItem);
    if (isIsolated) {
      issues.push({
        id: `list-isolated-${para.index}`,
        description: "列表项与正文混排",
        paragraphIndices: [para.index],
        severity: "info",
        sample: para.text.slice(0, 40),
      });
    }
  }
  return issues;
}

function detectColorHighlightIssues(
  paragraphs: ParagraphInfo[]
): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const color = (para.font.color || "").toLowerCase();
    if (color && color !== "#000000" && color !== "black" && color !== "#000") {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "color-highlight",
      description: "存在非必要颜色/高亮",
      paragraphIndices: indices,
      severity: "warning",
    },
  ];
}

function detectMixedTypographyIssues(
  paragraphs: ParagraphInfo[]
): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const text = para.text || "";
    if (chineseRegex.test(text) && englishRegex.test(text)) {
      if (/[^\s][A-Za-z]/.test(text) || /[A-Za-z][^\s]/.test(text)) {
        indices.push(para.index);
      }
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "mixed-typography",
      description: "中英混排间距或字体需统一",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectPunctuationIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  const pattern = /[，。？！；：、]\s+|\s+[,.!?;:]/;
  for (const para of paragraphs) {
    if (pattern.test(para.text || "")) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "punctuation-spacing",
      description: "标点与空格使用不规范",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectPaginationIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    if (para.pageBreakBefore) {
      indices.push(para.index);
      continue;
    }
    if (para.text.trim() === "") {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "pagination-control",
      description: "存在分页符/空行或分页控制问题",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectSpecialContentIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const text = para.text || "";
    if (/^>/.test(text) || /```/.test(text) || /`[^`]+`/.test(text)) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "special-content",
      description: "引用/代码等特殊内容格式不统一",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectUnderlineIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    const underline = para.font.underline;
    if (underline && underline !== "None" && underline !== "none") {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "underline-issues",
      description: "段落包含下划线格式",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectItalicIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    if (para.font.italic) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "italic-issues",
      description: "段落包含斜体格式",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectStrikethroughIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  for (const para of paragraphs) {
    if (para.font.strikeThrough) {
      indices.push(para.index);
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "strikethrough-issues",
      description: "段落包含删除线格式",
      paragraphIndices: indices,
      severity: "info",
    },
  ];
}

function detectCaptionIssues(paragraphs: ParagraphInfo[]): IssueItem[] {
  const indices: number[] = [];
  const captionPattern = /^(图|表|图表|Figure|Table)\s*([0-9]+)?[\.：:]/i;
  let figureCounter = 0;
  let tableCounter = 0;
  for (const para of paragraphs) {
    const match = para.text.trim().match(captionPattern);
    if (!match) continue;
    const prefix = match[1].toLowerCase();
    const number = match[2] ? parseInt(match[2], 10) : null;
    if (prefix.startsWith("图") || prefix.startsWith("figure")) {
      figureCounter += 1;
      if (!number || number !== figureCounter) {
        indices.push(para.index);
      }
    } else {
      tableCounter += 1;
      if (!number || number !== tableCounter) {
        indices.push(para.index);
      }
    }
  }
  if (indices.length === 0) return [];
  return [
    {
      id: "caption-issues",
      description: "图/表题注编号或样式异常",
      paragraphIndices: indices,
      severity: "warning",
    },
  ];
}

async function detectHeaderFooterIssues(): Promise<IssueItem[]> {
  const headerFooters = await getSectionHeadersFooters();
  if (headerFooters.length <= 1) return [];
  const first = headerFooters[0];
  const differences = headerFooters.some(
    (hf) =>
      hf.header.primary !== first.header.primary ||
      hf.footer.primary !== first.footer.primary ||
      hf.header.firstPage !== first.header.firstPage ||
      hf.header.evenPages !== first.header.evenPages
  );
  if (!differences) return [];
  return [
    {
      id: "header-footer-diff",
      description: "节间页眉页脚模板不一致",
      paragraphIndices: [],
      severity: "warning",
    },
  ];
}

async function detectTableIssues(): Promise<IssueItem[]> {
  return Word.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load("items");
    await context.sync();

    if (tables.items.length === 0) return [];

    const issues: IssueItem[] = [];
    for (let i = 0; i < tables.items.length; i++) {
      const table = tables.items[i];
      table.load("style, rowCount");
    }
    await context.sync();

    const inconsistentTables = tables.items.filter(
      (table) => !table.style || table.style === "Normal Table"
    );

    if (inconsistentTables.length > 0) {
      issues.push({
        id: "table-style",
        description: "表格样式或边框不统一",
        paragraphIndices: [],
        severity: "warning",
      });
    }

    return issues;
  });
}

async function updateTableOfContents(): Promise<void> {
  return Word.run(async (context) => {
    const docAny = context.document as unknown as { tablesOfContents?: unknown };
    const tocs = docAny.tablesOfContents as
      | { items: Array<{ update: () => void }>; load: (prop: string) => void }
      | undefined;

    if (tocs) {
      tocs.load("items");
      await context.sync();
      if (tocs.items.length > 0) {
        for (const toc of tocs.items) {
          toc.update();
        }
        await context.sync();
        return;
      }
    }

    const bodyAny = context.document.body as unknown as {
      insertTableOfContents?: (...args: unknown[]) => void;
    };

    if (typeof bodyAny.insertTableOfContents === "function") {
      bodyAny.insertTableOfContents(
        Word.InsertLocation.start,
        "TOC1",
        true,
        true,
        true,
        "Dots"
      );
      await context.sync();
    }
  });
}

function normalizeTypographyText(
  text: string,
  options: TypographyOptions
): { text: string; changed: boolean } {
  let updated = text;

  if (options.enforceSpacing) {
    updated = updated.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2");
    updated = updated.replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
    updated = updated.replace(/(\d)([A-Za-z])/g, "$1 $2");
    updated = updated.replace(/(\d)\s+([年年月日个项次度%℃])/g, "$1$2");
  }

  if (options.enforcePunctuation) {
    updated = updated.replace(/([，。？！；：、])\s+/g, "$1");
    updated = updated.replace(/\s+([,.!?;:])/g, "$1");
    updated = updated.replace(/([\u4e00-\u9fff])([,;:!?])/g, (_, cjk, p) => {
      const map: Record<string, string> = {
        ",": "，",
        ";": "；",
        ":": "：",
        "!": "！",
        "?": "？",
      };
      return cjk + (map[p] || p);
    });
  }

  return { text: updated, changed: updated !== text };
}

function buildCaptionFixMap(
  captions: ParagraphInfo[]
): Array<{ index: number; newText: string }> {
  const captionPattern = /^(图|表|图表|Figure|Table)\s*([0-9]+)?[\.：:]/i;
  let figureCounter = 0;
  let tableCounter = 0;
  const changes: Array<{ index: number; newText: string }> = [];

  for (const para of captions) {
    const match = para.text.trim().match(captionPattern);
    if (!match) continue;
    const prefix = match[1];
    const rest = para.text.trim().replace(captionPattern, "");
    if (/^图|图表|figure/i.test(prefix)) {
      figureCounter += 1;
      const newText = `${prefix}${figureCounter}：${rest}`.trim();
      if (newText !== para.text.trim()) {
        changes.push({ index: para.index, newText });
      }
    } else {
      tableCounter += 1;
      const newText = `${prefix}${tableCounter}：${rest}`.trim();
      if (newText !== para.text.trim()) {
        changes.push({ index: para.index, newText });
      }
    }
  }

  return changes;
}

function findCaptionParagraphs(paragraphs: ParagraphInfo[]): ParagraphInfo[] {
  const captionPattern = /^(图|表|图表|Figure|Table)\s*([0-9]+)?[\.：:]/i;
  return paragraphs.filter((p) => captionPattern.test(p.text.trim()));
}

function makeChangeItem(
  id: string,
  title: string,
  description: string,
  type: ChangeType,
  paragraphIndices: number[],
  data?: Record<string, unknown>,
  requiresContentChange: boolean = false
): ChangeItem {
  return {
    id,
    title,
    description,
    type,
    paragraphIndices,
    data,
    requiresContentChange,
  };
}

function buildChangePlan(
  paragraphs: ParagraphInfo[],
  formatSpec: FormatSpecification,
  colorAnalysis: ColorAnalysisItem[],
  formatMarkAnalysis: FormatMarkAnalysisItem[] = []
): ChangePlan {
  const items: ChangeItem[] = [];

  const headings = paragraphs.filter((p) => p.outlineLevel && p.outlineLevel > 0);
  const body = paragraphs.filter((p) => !p.outlineLevel && !p.isListItem);
  const listItems = paragraphs.filter((p) => p.isListItem);

  const headingFixes = detectHeadingLevelFixes(headings);
  if (headingFixes.length > 0) {
    items.push(
      makeChangeItem(
        "heading-level-fix",
        "修复标题层级",
        `修复 ${headingFixes.length} 处标题跳级`,
        "heading-level-fix",
        headingFixes.map((f) => f.index),
        { levelChanges: headingFixes }
      )
    );
  }

  const headingLevels = [1, 2, 3];
  for (const level of headingLevels) {
    const levelHeadings = headings.filter((p) => p.outlineLevel === level);
    if (levelHeadings.length === 0) continue;
    const reference = getDominantParagraph(levelHeadings);
    if (!reference) continue;
    const inconsistent = levelHeadings.filter((p) => formatMismatch(p, reference));
    if (inconsistent.length === 0) continue;
    items.push(
      makeChangeItem(
        `heading-style-${level}`,
        `统一${level}级标题样式`,
        `${level}级标题样式统一`,
        "heading-style",
        inconsistent.map((p) => p.index),
        { paragraphType: `heading${level}` }
      )
    );
  }

  if (body.length > 0) {
    const reference = getDominantParagraph(body);
    if (reference) {
      const inconsistent = body.filter((p) => formatMismatch(p, reference));
      if (inconsistent.length > 0) {
        items.push(
          makeChangeItem(
            "body-style",
            "统一正文样式",
            "统一正文段落字体与段落格式",
            "body-style",
            inconsistent.map((p) => p.index),
            { paragraphType: "bodyText" }
          )
        );
      }
    }
  }

  if (listItems.length > 0) {
    const reference = getDominantParagraph(listItems);
    if (reference) {
      const inconsistent = listItems.filter((p) => formatMismatch(p, reference));
      if (inconsistent.length > 0) {
        items.push(
          makeChangeItem(
            "list-style",
            "统一列表样式",
            "统一列表缩进与间距",
            "list-style",
            inconsistent.map((p) => p.index),
            { paragraphType: "listItem" }
          )
        );
      }
    }
  }

  if (headings.length > 0) {
    const numberingMap = buildHeadingNumberingMap(headings);
    if (numberingMap.length > 0) {
      items.push(
        makeChangeItem(
          "heading-numbering",
          "标题自动编号并更新目录",
          "生成多级标题编号并更新目录",
          "heading-numbering",
          numberingMap.map((item) => item.index),
          { numberingMap },
          true
        )
      );
    }
  }

  if (colorAnalysis.length > 0) {
    const unreasonable = colorAnalysis.filter((item) => !item.isReasonable);
    if (unreasonable.length > 0) {
      items.push(
        makeChangeItem(
          "color-correction",
          "颜色标识治理",
          `修正 ${unreasonable.length} 处不合理颜色`,
          "color-correction",
          unreasonable.map((item) => item.paragraphIndex),
          { colorItems: unreasonable }
        )
      );
    }
  }

  const captions = findCaptionParagraphs(paragraphs);
  if (captions.length > 0) {
    const captionFixMap = buildCaptionFixMap(captions);
    items.push(
      makeChangeItem(
        "caption-style",
        "图/表题注统一",
        "统一题注样式与编号",
        "caption-style",
        captions.map((c) => c.index),
        { captionFixMap },
        true
      )
    );
  }

  items.push(
    makeChangeItem(
      "table-style",
      "表格样式统一",
      "统一表头行、边框、对齐与行高",
      "table-style",
      []
    )
  );

  items.push(
    makeChangeItem(
      "image-alignment",
      "图片/图表对齐规范",
      "统一图片与正文的对齐和间距",
      "image-alignment",
      []
    )
  );

  items.push(
    makeChangeItem(
      "header-footer-template",
      "页眉页脚模板增强",
      "统一页眉页脚并支持首页/奇偶页与字段",
      "header-footer-template",
      [],
      { template: defaultHeaderFooterTemplate }
    )
  );

  items.push(
    makeChangeItem(
      "mixed-typography",
      "中英混排规范",
      "统一中英文间距与字体映射",
      "mixed-typography",
      paragraphs.map((p) => p.index),
      { typography: defaultTypographyOptions },
      true
    )
  );

  items.push(
    makeChangeItem(
      "punctuation-spacing",
      "标点与空格规范",
      "修正中文标点后空格、英文标点前空格等问题",
      "punctuation-spacing",
      paragraphs.map((p) => p.index),
      {
        typography: { ...defaultTypographyOptions, enforceSpacing: true, enforcePunctuation: true },
      },
      true
    )
  );

  items.push(
    makeChangeItem(
      "pagination-control",
      "段落分页控制",
      "设置标题与下段同页，清理分页符与空行",
      "pagination-control",
      paragraphs.map((p) => p.index),
      {},
      true
    )
  );

  items.push(
    makeChangeItem(
      "special-content",
      "特殊内容格式统一",
      "统一引用、代码、术语等特殊内容格式",
      "special-content",
      paragraphs.map((p) => p.index),
      {}
    )
  );

  // 基于AI分析结果处理下划线、斜体、删除线
  // 只清除AI判断为不合理的格式标记
  const unreasonableUnderlines = formatMarkAnalysis
    .filter((item) => item.formatType === "underline" && !item.shouldKeep)
    .map((item) => item.paragraphIndex);
  const unreasonableItalics = formatMarkAnalysis
    .filter((item) => item.formatType === "italic" && !item.shouldKeep)
    .map((item) => item.paragraphIndex);
  const unreasonableStrikethroughs = formatMarkAnalysis
    .filter((item) => item.formatType === "strikethrough" && !item.shouldKeep)
    .map((item) => item.paragraphIndex);

  // 统计保留的格式标记数量
  const keptUnderlines = formatMarkAnalysis.filter(
    (item) => item.formatType === "underline" && item.shouldKeep
  ).length;
  const keptItalics = formatMarkAnalysis.filter(
    (item) => item.formatType === "italic" && item.shouldKeep
  ).length;
  const keptStrikethroughs = formatMarkAnalysis.filter(
    (item) => item.formatType === "strikethrough" && item.shouldKeep
  ).length;

  // 检测下划线（只清除不合理的）
  if (unreasonableUnderlines.length > 0) {
    const description = keptUnderlines > 0
      ? `清除 ${unreasonableUnderlines.length} 处不合理下划线（保留 ${keptUnderlines} 处合理使用）`
      : `清除 ${unreasonableUnderlines.length} 个段落的下划线格式`;
    items.push(
      makeChangeItem(
        "underline-removal",
        "智能清除下划线",
        description,
        "underline-removal",
        unreasonableUnderlines,
        { formatMarkItems: formatMarkAnalysis.filter((item) => item.formatType === "underline") }
      )
    );
  }

  // 检测斜体（只清除不合理的）
  if (unreasonableItalics.length > 0) {
    const description = keptItalics > 0
      ? `清除 ${unreasonableItalics.length} 处不合理斜体（保留 ${keptItalics} 处合理使用）`
      : `清除 ${unreasonableItalics.length} 个段落的斜体格式`;
    items.push(
      makeChangeItem(
        "italic-removal",
        "智能清除斜体",
        description,
        "italic-removal",
        unreasonableItalics,
        { formatMarkItems: formatMarkAnalysis.filter((item) => item.formatType === "italic") }
      )
    );
  }

  // 检测删除线（只清除不合理的）
  if (unreasonableStrikethroughs.length > 0) {
    const description = keptStrikethroughs > 0
      ? `清除 ${unreasonableStrikethroughs.length} 处不合理删除线（保留 ${keptStrikethroughs} 处合理使用）`
      : `清除 ${unreasonableStrikethroughs.length} 个段落的删除线格式`;
    items.push(
      makeChangeItem(
        "strikethrough-removal",
        "智能清除删除线",
        description,
        "strikethrough-removal",
        unreasonableStrikethroughs,
        { formatMarkItems: formatMarkAnalysis.filter((item) => item.formatType === "strikethrough") }
      )
    );
  }

  return { items, formatSpec };
}

export function getOperationLogs(): OperationLogEntry[] {
  return [...operationLogs];
}

export async function addOperationLog(
  title: string,
  summary: string,
  scope: FormatScope,
  itemIds: string[] = []
): Promise<void> {
  const snapshot = await getDocumentOoxml();
  operationLogs.push({
    id: `op-${Date.now()}`,
    title,
    timestamp: Date.now(),
    scope,
    itemIds,
    summary,
    snapshot,
  });
}

export async function undoLastOptimization(): Promise<boolean> {
  const last = operationLogs.pop();
  if (!last) return false;
  await restoreDocumentOoxml(last.snapshot);
  return true;
}

export async function resolveScopeParagraphIndices(
  scope: FormatScope,
  paragraphs?: ParagraphInfo[]
): Promise<number[]> {
  switch (scope.type) {
    case "selection":
      return getParagraphIndicesInSelection();
    case "currentSection":
      return getParagraphIndicesInCurrentSection();
    case "paragraphs":
      return uniqueSorted(scope.paragraphIndices || []);
    default: {
      const allParagraphs = paragraphs || (await getAllParagraphsInfo());
      if (scope.type === "document") {
        return allParagraphs.map((p) => p.index);
      }
      if (scope.type === "headings") {
        return allParagraphs
          .filter((p) => p.outlineLevel && p.outlineLevel > 0)
          .map((p) => p.index);
      }
      if (scope.type === "bodyText") {
        return allParagraphs
          .filter((p) => !p.outlineLevel && !p.isListItem)
          .map((p) => p.index);
      }
      return allParagraphs.map((p) => p.index);
    }
  }
}

export async function analyzeFormatSession(
  scope: FormatScope,
  options?: { onProgress?: ProgressCallback; useAI?: boolean; cancelToken?: CancelToken }
): Promise<FormatAnalysisSession> {
  const onProgress = options?.onProgress;
  const cancelToken = options?.cancelToken;

  // 创建AbortController用于取消fetch请求，并存储到cancelToken中
  const abortController = new AbortController();
  if (cancelToken) {
    cancelToken.abortController = abortController;
  }

  const checkCancelled = () => {
    if (cancelToken?.cancelled) {
      abortController.abort();
      throw new Error("操作已取消");
    }
  };

  checkCancelled();
  onProgress?.(0, 6, "正在读取段落信息...");

  const allParagraphs = await getAllParagraphsInfo();
  checkCancelled();

  const scopeIndices = await resolveScopeParagraphIndices(scope, allParagraphs);
  const scopedParagraphs =
    scope.type === "document" ? allParagraphs : filterParagraphsByIndices(allParagraphs, scopeIndices);

  checkCancelled();
  onProgress?.(1, 6, "正在分析格式与问题...");

  let formatSpec: FormatSpecification | null = null;
  let inconsistencies: string[] = [];
  let suggestions: string[] = [];
  let colorAnalysis: ColorAnalysisItem[] = [];
  let formatMarkAnalysis: FormatMarkAnalysisItem[] = [];

  if (options?.useAI !== false) {
    try {
      checkCancelled();
      const aiResult = await analyzeAndGenerateFormatSpec(undefined, abortController.signal);
      formatSpec = aiResult.formatSpec;
      inconsistencies = aiResult.inconsistencies;
      suggestions = aiResult.suggestions;
      colorAnalysis = aiResult.colorAnalysis || [];
      formatMarkAnalysis = aiResult.formatMarkAnalysis || [];
    } catch (err) {
      if (err instanceof Error && (err.message === "操作已取消" || err.name === "AbortError")) {
        throw new Error("操作已取消");
      }
      formatSpec = null;
    }
  }

  checkCancelled();

  // 不再使用后备方案，如果AI分析失败则保持为空
  // formatSpec、colorAnalysis、formatMarkAnalysis 直接使用AI返回的结果

  const headings = scopedParagraphs.filter((p) => p.outlineLevel && p.outlineLevel > 0);
  const body = scopedParagraphs.filter((p) => !p.outlineLevel && !p.isListItem);
  const listItems = scopedParagraphs.filter((p) => p.isListItem);

  const issues: IssueCategory[] = [];

  const hierarchyIssues = [
    ...detectHierarchyIssues(headings),
    ...detectListInBodyIssues(scopedParagraphs),
  ];
  issues.push({
    id: "hierarchy",
    title: "段落层级检测",
    summary: `${hierarchyIssues.length} 项`,
    items: hierarchyIssues,
  });

  const headingIssues = [
    ...detectHeadingConsistencyIssues(headings, 1),
    ...detectHeadingConsistencyIssues(headings, 2),
    ...detectHeadingConsistencyIssues(headings, 3),
  ];
  issues.push({
    id: "heading-consistency",
    title: "标题一致性",
    summary: `${headingIssues.length} 项`,
    items: headingIssues,
  });

  const bodyIssues = detectBodyConsistencyIssues(body);
  issues.push({
    id: "body-consistency",
    title: "正文一致性",
    summary: `${bodyIssues.length} 项`,
    items: bodyIssues,
  });

  const listIssues = detectListConsistencyIssues(listItems);
  issues.push({
    id: "list-consistency",
    title: "列表规范",
    summary: `${listIssues.length} 项`,
    items: listIssues,
  });

  const colorIssues = detectColorHighlightIssues(scopedParagraphs);
  issues.push({
    id: "color-highlight",
    title: "颜色与高亮",
    summary: `${colorIssues.length} 项`,
    items: colorIssues,
  });

  const mixedIssues = detectMixedTypographyIssues(scopedParagraphs);
  issues.push({
    id: "mixed-typography",
    title: "中英混排",
    summary: `${mixedIssues.length} 项`,
    items: mixedIssues,
  });

  const punctuationIssues = detectPunctuationIssues(scopedParagraphs);
  issues.push({
    id: "punctuation-spacing",
    title: "标点与空格",
    summary: `${punctuationIssues.length} 项`,
    items: punctuationIssues,
  });

  const paginationIssues = detectPaginationIssues(scopedParagraphs);
  issues.push({
    id: "pagination-control",
    title: "分页控制",
    summary: `${paginationIssues.length} 项`,
    items: paginationIssues,
  });

  const headerFooterIssues = await detectHeaderFooterIssues();
  issues.push({
    id: "header-footer",
    title: "页眉页脚差异",
    summary: `${headerFooterIssues.length} 项`,
    items: headerFooterIssues,
  });

  const tableIssues = await detectTableIssues();
  issues.push({
    id: "table-style",
    title: "表格规范",
    summary: `${tableIssues.length} 项`,
    items: tableIssues,
  });

  const captionIssues = detectCaptionIssues(scopedParagraphs);
  issues.push({
    id: "caption-style",
    title: "图/表题注",
    summary: `${captionIssues.length} 项`,
    items: captionIssues,
  });

  const specialIssues = detectSpecialContentIssues(scopedParagraphs);
  issues.push({
    id: "special-content",
    title: "特殊内容",
    summary: `${specialIssues.length} 项`,
    items: specialIssues,
  });

  const underlineIssues = detectUnderlineIssues(scopedParagraphs);
  issues.push({
    id: "underline",
    title: "下划线",
    summary: `${underlineIssues.length} 项`,
    items: underlineIssues,
  });

  const italicIssues = detectItalicIssues(scopedParagraphs);
  issues.push({
    id: "italic",
    title: "斜体",
    summary: `${italicIssues.length} 项`,
    items: italicIssues,
  });

  const strikethroughIssues = detectStrikethroughIssues(scopedParagraphs);
  issues.push({
    id: "strikethrough",
    title: "删除线",
    summary: `${strikethroughIssues.length} 项`,
    items: strikethroughIssues,
  });

  checkCancelled();
  onProgress?.(4, 6, "正在生成优化方案...");

  // 如果AI分析失败（formatSpec为null），使用空的格式规范
  const changePlan = buildChangePlan(scopedParagraphs, formatSpec || {}, colorAnalysis, formatMarkAnalysis);

  checkCancelled();
  onProgress?.(6, 6, "分析完成");

  return {
    scope,
    paragraphCount: scopedParagraphs.length,
    sectionCount: (await getSectionHeadersFooters()).length,
    issues,
    formatSpec,
    colorAnalysis,
    formatMarkAnalysis,
    suggestions,
    inconsistencies,
    changePlan,
  };
}

async function applyHeadingLevelFix(
  changes: Array<{ index: number; level: number }>
): Promise<void> {
  if (changes.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const change of changes) {
      if (change.index < 0 || change.index >= paragraphs.items.length) continue;
      const para = paragraphs.items[change.index];
      const headingName = `Heading ${change.level}`;
      try {
        para.style = headingName;
      } catch {
        para.style = `标题 ${change.level}`;
      }
    }

    await context.sync();
  });
}

async function applyHeadingNumbering(
  numberingMap: Array<{ index: number; newText: string }>
): Promise<void> {
  if (numberingMap.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const change of numberingMap) {
      if (change.index < 0 || change.index >= paragraphs.items.length) continue;
      const para = paragraphs.items[change.index];
      para.insertText(change.newText, Word.InsertLocation.replace);
    }

    await context.sync();
  });
}

async function applyTableFormatting(): Promise<void> {
  await Word.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load("items");
    await context.sync();

    for (const table of tables.items) {
      table.style = "Table Grid";
      const rows = table.rows;
      rows.load("items");
      await context.sync();

      if (rows.items.length > 0) {
        const headerRow = rows.items[0];
        headerRow.font.bold = true;
        (headerRow as unknown as { shadingColor?: string }).shadingColor = "#F2F2F2";
        (headerRow as unknown as { height?: number }).height = 18;
      }
    }

    await context.sync();
  });
}

async function applyCaptionFormatting(
  captionFixMap: Array<{ index: number; newText: string }>
): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const item of captionFixMap) {
      if (item.index < 0 || item.index >= paragraphs.items.length) continue;
      const para = paragraphs.items[item.index];
      para.insertText(item.newText, Word.InsertLocation.replace);
      para.alignment = Word.Alignment.centered;
      para.font.bold = false;
      para.font.size = 10.5;
    }

    await context.sync();
  });
}

async function applyImageAlignment(): Promise<void> {
  await Word.run(async (context) => {
    const pics = context.document.body.inlinePictures;
    pics.load("items");
    await context.sync();

    for (const pic of pics.items) {
      const range = pic.getRange();
      const paragraphs = range.paragraphs;
      paragraphs.load("items");
      await context.sync();
      for (const para of paragraphs.items) {
        para.alignment = Word.Alignment.centered;
        para.spaceBefore = 6;
        para.spaceAfter = 6;
      }
    }

    await context.sync();
  });
}

export async function applyHeaderFooterTemplate(
  template: HeaderFooterTemplate
): Promise<void> {
  const documentName = await getDocumentName();
  const today = new Date().toLocaleDateString();

  await Word.run(async (context) => {
    const sections = context.document.sections;
    sections.load("items");
    await context.sync();

    for (const section of sections.items) {
      const pageSetup = section.pageSetup as unknown as {
        differentFirstPageHeaderFooter?: boolean;
        oddAndEvenPagesHeaderFooter?: boolean;
      };
      if (template.useDifferentFirstPage) {
        pageSetup.differentFirstPageHeaderFooter = true;
      }
      if (template.useDifferentOddEven) {
        pageSetup.oddAndEvenPagesHeaderFooter = true;
      }

      const insertContent = (target: Word.Body, text: string | undefined) => {
        target.clear();
        let finalText = text || "";
        if (template.includeDocumentName && !finalText.includes("{documentName}")) {
          finalText = `{documentName} ${finalText}`.trim();
        }
        if (template.includeDate && !finalText.includes("{date}")) {
          finalText = `${finalText} {date}`.trim();
        }
        if (template.includePageNumber && !finalText.includes("{pageNumber}")) {
          finalText = `${finalText} {pageNumber}`.trim();
        }
        finalText = finalText
          .replace(/\{documentName\}/g, documentName)
          .replace(/\{date\}/g, today);

        // 简化逻辑：如果包含页码占位符，分段插入；否则直接插入全部文本
        if (finalText.includes("{pageNumber}")) {
          const parts = finalText.split(/(\{pageNumber\})/g);
          for (const part of parts) {
            if (!part) continue;
            if (part === "{pageNumber}") {
              // 尝试插入页码字段
              try {
                const range = target.getRange(Word.RangeLocation.end);
                // 使用 insertField 方法插入页码字段
                (range as unknown as { insertField?: (loc: Word.InsertLocation, type: Word.FieldType) => Word.Field })
                  .insertField?.(Word.InsertLocation.end, Word.FieldType.page);
              } catch {
                // 如果插入字段失败，插入占位符文本
                target.insertText("#", Word.InsertLocation.end);
              }
            } else {
              target.insertText(part, Word.InsertLocation.end);
            }
          }
        } else {
          target.insertText(finalText, Word.InsertLocation.start);
        }
      };

      if (template.primaryHeader) {
        const header = section.getHeader(Word.HeaderFooterType.primary);
        insertContent(header, template.primaryHeader);
      }
      if (template.primaryFooter) {
        const footer = section.getFooter(Word.HeaderFooterType.primary);
        insertContent(footer, template.primaryFooter);
      }

      if (template.useDifferentFirstPage) {
        const firstHeader = section.getHeader(Word.HeaderFooterType.firstPage);
        const firstFooter = section.getFooter(Word.HeaderFooterType.firstPage);
        insertContent(firstHeader, template.firstPageHeader || template.primaryHeader);
        insertContent(firstFooter, template.firstPageFooter || template.primaryFooter);
      }

      if (template.useDifferentOddEven) {
        const evenHeader = section.getHeader(Word.HeaderFooterType.evenPages);
        const evenFooter = section.getFooter(Word.HeaderFooterType.evenPages);
        insertContent(evenHeader, template.evenPageHeader || template.primaryHeader);
        insertContent(evenFooter, template.evenPageFooter || template.primaryFooter);
      }
    }

    await context.sync();
  });
}

export async function applyTypographyNormalization(
  paragraphIndices: number[],
  options: TypographyOptions
): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      para.load("text");
    }
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const result = normalizeTypographyText(para.text, options);
      if (result.changed) {
        para.insertText(result.text, Word.InsertLocation.replace);
      }

      const fontAny = para.font as unknown as {
        name?: string;
        nameAscii?: string;
        nameEastAsia?: string;
      };
      fontAny.name = options.chineseFont;
      fontAny.nameAscii = options.englishFont;
      fontAny.nameEastAsia = options.chineseFont;
    }

    await context.sync();
  });
}

export async function removeUnderline(paragraphIndices: number[]): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      para.font.underline = Word.UnderlineType.none;
    }

    await context.sync();
  });
}

export async function removeItalic(paragraphIndices: number[]): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      para.font.italic = false;
    }

    await context.sync();
  });
}

export async function removeStrikethrough(paragraphIndices: number[]): Promise<void> {
  if (paragraphIndices.length === 0) return;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      para.font.strikeThrough = false;
    }

    await context.sync();
  });
}

async function applyPaginationControl(paragraphIndices: number[]): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      para.load("text, style, pageBreakBefore");
    }
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const text = para.text || "";

      if (text.trim() === "") {
        if (index > 0) {
          para.delete();
        }
        continue;
      }

      const isHeading =
        para.style?.toString().toLowerCase().includes("heading") ||
        para.style?.toString().includes("标题");
      if (isHeading) {
        (para as unknown as { keepWithNext?: boolean }).keepWithNext = true;
        (para as unknown as { keepTogether?: boolean }).keepTogether = true;
      }
      (para as unknown as { widowControl?: boolean }).widowControl = true;

      if ((para as unknown as { pageBreakBefore?: boolean }).pageBreakBefore) {
        (para as unknown as { pageBreakBefore?: boolean }).pageBreakBefore = false;
      }
    }

    await context.sync();
  });
}

async function applySpecialContentFormatting(
  paragraphIndices: number[]
): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      para.load("text");
    }
    await context.sync();

    for (const index of paragraphIndices) {
      if (index < 0 || index >= paragraphs.items.length) continue;
      const para = paragraphs.items[index];
      const text = para.text || "";
      if (/```/.test(text) || /`[^`]+`/.test(text)) {
        para.font.name = "Consolas";
        para.font.size = 10;
        para.spaceBefore = 6;
        para.spaceAfter = 6;
      }
      if (/^>/.test(text)) {
        para.leftIndent = 12;
        para.font.italic = true;
        para.spaceBefore = 6;
        para.spaceAfter = 6;
      }
    }

    await context.sync();
  });
}

export async function applyChangePlan(
  session: FormatAnalysisSession,
  selectedItemIds: string[],
  options?: {
    onProgress?: ProgressCallback;
    cancelToken?: CancelToken;
    headerFooterTemplate?: HeaderFooterTemplate;
    typographyOptions?: TypographyOptions;
    colorSelections?: number[];
  }
): Promise<void> {
  const onProgress = options?.onProgress;
  const cancelToken = options?.cancelToken;
  const items = session.changePlan.items.filter((item) =>
    selectedItemIds.includes(item.id)
  );

  if (items.length === 0) return;

  const snapshot = await getDocumentOoxml();
  const needsContentChange = items.some((item) => item.requiresContentChange);
  const beforeCheckpoint = await createContentCheckpoint();

  onProgress?.(0, items.length, "正在应用优化...");

  for (let i = 0; i < items.length; i++) {
    if (cancelToken?.cancelled) {
      throw new Error("操作已取消");
    }

    const item = items[i];
    onProgress?.(i, items.length, `正在处理：${item.title}`);

    switch (item.type) {
      case "heading-level-fix": {
        const levelChanges = (item.data?.levelChanges || []) as Array<{
          index: number;
          level: number;
        }>;
        await applyHeadingLevelFix(levelChanges);
        break;
      }
      case "heading-style": {
        const paragraphType = item.data?.paragraphType as
          | "heading1"
          | "heading2"
          | "heading3";
        if (paragraphType && session.formatSpec) {
          await applyFormatToParagraphsBatch(
            session.formatSpec,
            item.paragraphIndices.map((index) => ({ index, type: paragraphType })),
            20
          );
        }
        break;
      }
      case "body-style": {
        if (session.formatSpec) {
          await applyFormatToParagraphsBatch(
            session.formatSpec,
            item.paragraphIndices.map((index) => ({ index, type: "bodyText" })),
            20
          );
        }
        break;
      }
      case "list-style": {
        if (session.formatSpec) {
          await applyFormatToParagraphsBatch(
            session.formatSpec,
            item.paragraphIndices.map((index) => ({ index, type: "listItem" })),
            20
          );
        }
        break;
      }
      case "heading-numbering": {
        const numberingMap = (item.data?.numberingMap || []) as Array<{
          index: number;
          newText: string;
        }>;
        await applyHeadingNumbering(numberingMap);
        await updateTableOfContents();
        break;
      }
      case "table-style":
        await applyTableFormatting();
        break;
      case "caption-style": {
        const captionFixMap = (item.data?.captionFixMap || []) as Array<{
          index: number;
          newText: string;
        }>;
        await applyCaptionFormatting(captionFixMap);
        break;
      }
      case "image-alignment":
        await applyImageAlignment();
        break;
      case "header-footer-template": {
        const template =
          options?.headerFooterTemplate ||
          (item.data?.template as HeaderFooterTemplate) ||
          defaultHeaderFooterTemplate;
        await applyHeaderFooterTemplate(template);
        break;
      }
      case "color-correction": {
        const colorItems =
          (item.data?.colorItems as ColorAnalysisItem[]) || session.colorAnalysis;
        const selectedIndices = options?.colorSelections;
        const selectedItems = selectedIndices
          ? colorItems.filter((colorItem) =>
              selectedIndices.includes(colorItem.paragraphIndex)
            )
          : colorItems;
        await applyColorAnalysisCorrections(selectedItems);
        break;
      }
      case "mixed-typography": {
        const typography =
          options?.typographyOptions ||
          (item.data?.typography as TypographyOptions) ||
          defaultTypographyOptions;
        await applyTypographyNormalization(item.paragraphIndices, typography);
        break;
      }
      case "punctuation-spacing": {
        const typography =
          (item.data?.typography as TypographyOptions) ||
          defaultTypographyOptions;
        await applyTypographyNormalization(item.paragraphIndices, {
          ...typography,
          enforceSpacing: true,
          enforcePunctuation: true,
        });
        break;
      }
      case "pagination-control":
        await applyPaginationControl(item.paragraphIndices);
        break;
      case "special-content":
        await applySpecialContentFormatting(item.paragraphIndices);
        break;
      case "underline-removal":
        await removeUnderline(item.paragraphIndices);
        break;
      case "italic-removal":
        await removeItalic(item.paragraphIndices);
        break;
      case "strikethrough-removal":
        await removeStrikethrough(item.paragraphIndices);
        break;
      default:
        break;
    }
  }

  onProgress?.(items.length, items.length, "优化完成");

  const afterCheckpoint = await createContentCheckpoint();
  const integrityResult = verifyContentIntegrity(beforeCheckpoint, afterCheckpoint);
  if (!integrityResult.valid && !needsContentChange) {
    throw new Error(`内容完整性校验失败: ${integrityResult.error}`);
  }

  const summary = items.map((item) => item.title).join("、");
  const summaryWithIntegrity =
    !integrityResult.valid && needsContentChange
      ? `${summary}（内容校验提示：${integrityResult.error}）`
      : summary;

  operationLogs.push({
    id: `batch-${Date.now()}`,
    title: "批次优化",
    timestamp: Date.now(),
    scope: session.scope,
    itemIds: items.map((item) => item.id),
    summary: summaryWithIntegrity,
    snapshot,
  });
}
