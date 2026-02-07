/**
 * AI排版服务 - AI集成
 * 调用AI进行格式分析和页眉页脚分析
 */

import { callAI } from "../aiService";
import {
  DocumentFormatSample,
  SectionHeaderFooter,
} from "../wordApi";
import { getPrompt } from "../promptService";
import {
  FormatAnalysisResult,
  HeaderFooterUnifyPlan,
} from "./types";
import { contextManager, sanitizeFormatSpec } from "./utils";

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

/**
 * 调用AI分析格式
 */
export async function callAIForFormatAnalysis(
  samples: DocumentFormatSample,
  _abortSignal?: AbortSignal
): Promise<FormatAnalysisResult> {
  const compressedSamples = {
    headings: contextManager.compressFormatSamples(samples.headings, 30),
    bodyText: contextManager.compressFormatSamples(samples.bodyText, 30),
    lists: contextManager.compressFormatSamples(samples.lists, 30),
    tables: samples.tables,
  };

  const prompt = `请分析以下文档格式样本并生成统一规范：\n${JSON.stringify(compressedSamples, null, 2)}`;
  const systemPrompt = getFormatAnalysisSystemPrompt();

  const response = await callAI(prompt, systemPrompt);

  return parseFormatAnalysisResult(response.content);
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
