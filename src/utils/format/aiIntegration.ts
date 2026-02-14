/**
 * AI排版服务 - AI集成
 * 调用AI进行格式分析和页眉页脚分析
 */

import { callAI } from "../aiService";
import {
  DocumentFormatSample,
  FormatSpecification,
  SectionHeaderFooter,
} from "../wordApi";
import { getPrompt } from "../promptService";
import {
  ColorAnalysisItem,
  FormatAnalysisResult,
  FormatMarkAnalysisItem,
  HeaderFooterUnifyPlan,
} from "./types";
import { contextManager, sanitizeFormatSpec } from "./utils";

const FORMAT_ANALYSIS_STRUCTURED_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    formatSpec: {
      type: "object",
      additionalProperties: true,
    },
    inconsistencies: {
      type: "array",
      items: { type: "string" },
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
    },
    colorAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          paragraphIndex: { type: "number" },
          text: { type: "string" },
          currentColor: { type: "string" },
          isReasonable: { type: "boolean" },
          reason: { type: "string" },
          suggestedColor: { type: "string" },
        },
      },
    },
    formatMarkAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          paragraphIndex: { type: "number" },
          text: { type: "string" },
          formatType: { type: "string", enum: ["underline", "italic", "strikethrough"] },
          isReasonable: { type: "boolean" },
          reason: { type: "string" },
          shouldKeep: { type: "boolean" },
        },
      },
    },
  },
  required: ["formatSpec", "inconsistencies", "suggestions", "colorAnalysis", "formatMarkAnalysis"],
};

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

function shouldFallbackToUnstructured(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message || "";
  const statusMatch = message.match(/状态码\s*(\d+)/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : NaN;
  const schemaUnsupportedHint =
    /response[_\s-]?format|response[_\s-]?schema|json[_\s-]?schema|schema/i.test(message);

  if (schemaUnsupportedHint && Number.isFinite(status)) {
    return status === 400 || status === 404 || status === 415 || status === 422;
  }
  return schemaUnsupportedHint && !Number.isFinite(status);
}

function parseJSONCandidate(candidate: string): Record<string, unknown> | null {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractFencedJSON(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    if (match[1]) {
      blocks.push(match[1]);
    }
    match = regex.exec(content);
  }
  return blocks;
}

function extractBalancedJSONObject(content: string): string | null {
  for (let start = content.indexOf("{"); start !== -1; start = content.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return content.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

function parseJSONObjectFromContent(content: string): Record<string, unknown> | null {
  const direct = parseJSONCandidate(content);
  if (direct) {
    return direct;
  }

  for (const block of extractFencedJSON(content)) {
    const parsed = parseJSONCandidate(block);
    if (parsed) {
      return parsed;
    }
  }

  const balanced = extractBalancedJSONObject(content);
  if (balanced) {
    return parseJSONCandidate(balanced);
  }

  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toColorAnalysisArray(value: unknown): ColorAnalysisItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      const paragraphIndex = Number(record.paragraphIndex);
      if (!Number.isFinite(paragraphIndex) || paragraphIndex < 0) {
        return null;
      }
      return {
        paragraphIndex,
        text: typeof record.text === "string" ? record.text : "",
        currentColor: typeof record.currentColor === "string" ? record.currentColor : "",
        isReasonable: record.isReasonable === true,
        reason: typeof record.reason === "string" ? record.reason : "",
        suggestedColor: typeof record.suggestedColor === "string" ? record.suggestedColor : "#000000",
      } satisfies ColorAnalysisItem;
    })
    .filter((item): item is ColorAnalysisItem => !!item);
}

function toFormatMarkAnalysisArray(value: unknown): FormatMarkAnalysisItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      const paragraphIndex = Number(record.paragraphIndex);
      const formatType = record.formatType;
      if (
        !Number.isFinite(paragraphIndex) ||
        paragraphIndex < 0 ||
        (formatType !== "underline" && formatType !== "italic" && formatType !== "strikethrough")
      ) {
        return null;
      }
      return {
        paragraphIndex,
        text: typeof record.text === "string" ? record.text : "",
        formatType,
        isReasonable: record.isReasonable === true,
        reason: typeof record.reason === "string" ? record.reason : "",
        shouldKeep: record.shouldKeep === true,
      } satisfies FormatMarkAnalysisItem;
    })
    .filter((item): item is FormatMarkAnalysisItem => !!item);
}

async function callAIForFormatAnalysisCore(
  prompt: string,
  systemPrompt: string,
  abortSignal?: AbortSignal
): Promise<string> {
  try {
    const structuredResponse = await callAI(prompt, systemPrompt, {
      signal: abortSignal,
      structuredOutput: {
        name: "format_analysis_result",
        schema: FORMAT_ANALYSIS_STRUCTURED_SCHEMA,
        strict: false,
      },
    });
    return structuredResponse.content;
  } catch (error) {
    if (isAbortError(error) || !shouldFallbackToUnstructured(error)) {
      throw error;
    }
    const fallbackResponse = await callAI(prompt, systemPrompt, { signal: abortSignal });
    return fallbackResponse.content;
  }
}

/**
 * 格式分析系统提示词（可在设置中修改）
 */
function getFormatAnalysisSystemPrompt(): string {
  return getPrompt("format_analysis");
}

/**
 * 页眉页脚分析系统提示词（可在设置中修改）
 */
function getHeaderFooterSystemPrompt(): string {
  return getPrompt("header_footer_analysis");
}

/**
 * 解析格式分析结果
 */
function parseFormatAnalysisResult(content: string): FormatAnalysisResult {
  const result = parseJSONObjectFromContent(content);
  if (!result) {
    throw new Error("无法解析AI返回的格式规范");
  }

  const rawFormatSpec = result.formatSpec;
  const safeFormatSpec: FormatSpecification =
    rawFormatSpec && typeof rawFormatSpec === "object"
      ? (rawFormatSpec as FormatSpecification)
      : {};

  return {
    formatSpec: sanitizeFormatSpec(safeFormatSpec),
    inconsistencies: toStringArray(result.inconsistencies),
    suggestions: toStringArray(result.suggestions),
    colorAnalysis: toColorAnalysisArray(result.colorAnalysis),
    formatMarkAnalysis: toFormatMarkAnalysisArray(result.formatMarkAnalysis),
  };
}

/**
 * 解析页眉页脚统一方案
 */
function parseHeaderFooterPlan(content: string): HeaderFooterUnifyPlan {
  const result = parseJSONObjectFromContent(content);
  if (!result) {
    return {
      shouldUnify: false,
      reason: "无法解析AI返回的方案",
    };
  }

  return {
    shouldUnify: result.shouldUnify === true,
    headerText: typeof result.headerText === "string" ? result.headerText : undefined,
    footerText: typeof result.footerText === "string" ? result.footerText : undefined,
    reason: typeof result.reason === "string" ? result.reason : "",
  };
}

/**
 * 调用AI分析格式
 */
export async function callAIForFormatAnalysis(
  samples: DocumentFormatSample,
  abortSignal?: AbortSignal
): Promise<FormatAnalysisResult> {
  const compressedSamples = {
    headings: contextManager.compressFormatSamples(samples.headings, 30),
    bodyText: contextManager.compressFormatSamples(samples.bodyText, 30),
    lists: contextManager.compressFormatSamples(samples.lists, 30),
    tables: samples.tables,
  };

  const prompt = `请分析以下文档格式样本并生成统一规范：\n${JSON.stringify(compressedSamples, null, 2)}`;
  const systemPrompt = getFormatAnalysisSystemPrompt();

  const content = await callAIForFormatAnalysisCore(prompt, systemPrompt, abortSignal);
  return parseFormatAnalysisResult(content);
}

/**
 * 调用AI分析页眉页脚
 */
export async function callAIForHeaderFooterAnalysis(
  headerFooters: SectionHeaderFooter[]
): Promise<HeaderFooterUnifyPlan> {
  const prompt = `请分析以下各节的页眉页脚并建议统一方案：\n${JSON.stringify(headerFooters, null, 2)}`;
  const systemPrompt = getHeaderFooterSystemPrompt();

  const response = await callAI(prompt, systemPrompt);

  return parseHeaderFooterPlan(response.content);
}
