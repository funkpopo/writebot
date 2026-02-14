/**
 * AI排版服务 - 变更应用
 * 将格式变更应用到文档中（高层编排逻辑）
 */

import {
  FormatSpecification,
  DocumentFormatSample,
  getAllParagraphsInfo,
  getSectionHeadersFooters,
  getDocumentOoxml,
  restoreDocumentOoxml,
  createContentCheckpoint,
  verifyContentIntegrity,
  applyFormatToParagraphsBatch,
  applyHeaderFooterToAllSections,
  applyColorCorrections,
  ColorCorrectionItem,
  sampleDocumentFormats,
} from "../wordApi";
import { sanitizeMarkdownToPlainText } from "../textSanitizer";
import {
  ColorAnalysisItem,
  FormatScope,
  FormatAnalysisSession,
  ChangeItem,
  ChangeType,
  HeaderFooterTemplate,
  TypographyOptions,
  ProgressCallback,
  CancelToken,
  OperationLogEntry,
} from "./types";
import {
  operationLogs,
  defaultTypographyOptions,
  defaultHeaderFooterTemplate,
  uniqueSorted,
} from "./utils";
import { callAIForHeaderFooterAnalysis } from "./aiIntegration";
import type { HeaderFooterUnifyPlan } from "./types";
import {
  applyHeadingLevelFix,
  applyHeadingNumbering,
  applyTableFormatting,
  applyCaptionFormatting,
  applyImageAlignment,
  updateTableOfContents,
  applyPaginationControl,
  applySpecialContentFormatting,
} from "./wordOperations";

// Re-export Word operations that are part of the public API
export {
  applyHeaderFooterTemplate,
  applyTypographyNormalization,
  removeUnderline,
  removeItalic,
  removeStrikethrough,
} from "./wordOperations";

const STRUCTURAL_CHANGE_TYPES: ChangeType[] = ["pagination-control"];
const TYPOGRAPHY_CHANGE_TYPES: ChangeType[] = ["mixed-typography", "punctuation-spacing"];

function isStructuralChangeItem(item: ChangeItem): boolean {
  return STRUCTURAL_CHANGE_TYPES.includes(item.type);
}

function isTypographyChangeItem(item: ChangeItem): boolean {
  return TYPOGRAPHY_CHANGE_TYPES.includes(item.type);
}

function mergeTypographyOptions(
  items: ChangeItem[],
  preferredOptions?: TypographyOptions
): TypographyOptions {
  const merged: TypographyOptions = {
    chineseFont: preferredOptions?.chineseFont || "",
    englishFont: preferredOptions?.englishFont || "",
    enforceSpacing: preferredOptions?.enforceSpacing ?? false,
    enforcePunctuation: preferredOptions?.enforcePunctuation ?? false,
  };

  for (const item of items) {
    const typography = item.data?.typography;
    if (!typography || typeof typography !== "object") {
      continue;
    }
    const partial = typography as Partial<TypographyOptions>;
    if (!merged.chineseFont && typeof partial.chineseFont === "string" && partial.chineseFont.trim()) {
      merged.chineseFont = partial.chineseFont;
    }
    if (!merged.englishFont && typeof partial.englishFont === "string" && partial.englishFont.trim()) {
      merged.englishFont = partial.englishFont;
    }
    if (partial.enforceSpacing === true) {
      merged.enforceSpacing = true;
    }
    if (partial.enforcePunctuation === true) {
      merged.enforcePunctuation = true;
    }
  }

  if (!merged.chineseFont) {
    merged.chineseFont = defaultTypographyOptions.chineseFont;
  }
  if (!merged.englishFont) {
    merged.englishFont = defaultTypographyOptions.englishFont;
  }

  return merged;
}

export function mergeTypographyChangeItems(
  items: ChangeItem[],
  preferredOptions?: TypographyOptions
): ChangeItem[] {
  if (items.length <= 1) {
    return [...items];
  }

  const typographyEntries = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => isTypographyChangeItem(entry.item));

  if (typographyEntries.length <= 1) {
    return [...items];
  }

  const typographyItems = typographyEntries.map((entry) => entry.item);
  const mergedChangeIds = typographyItems.map((item) => item.id);
  const mergedChangeTitles = typographyItems.map((item) => item.title);
  const mergedTypography = mergeTypographyOptions(typographyItems, preferredOptions);
  const mergedParagraphIndices = uniqueSorted(
    typographyItems.flatMap((item) => item.paragraphIndices)
  );
  const mergedTitle =
    mergedChangeTitles.length > 2
      ? `${mergedChangeTitles[0]}等${mergedChangeTitles.length}项`
      : mergedChangeTitles.join(" + ");
  const mergedDescription = `合并执行：${mergedChangeTitles.join("、")}`;
  const firstTypographyIndex = typographyEntries[0].index;
  const mergedItem: ChangeItem = {
    ...typographyItems[0],
    id: mergedChangeIds.join("+"),
    title: mergedTitle,
    description: mergedDescription,
    type: "mixed-typography",
    paragraphIndices: mergedParagraphIndices,
    requiresContentChange: typographyItems.some((item) => item.requiresContentChange),
    data: {
      ...(typographyItems[0].data || {}),
      typography: mergedTypography,
      mergedChangeIds,
      mergedChangeTitles,
    },
  };

  const result: ChangeItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i === firstTypographyIndex) {
      result.push(mergedItem);
    }
    if (isTypographyChangeItem(item)) {
      continue;
    }
    result.push(item);
  }

  return result;
}

export function orderChangeItemsForExecution(items: ChangeItem[]): ChangeItem[] {
  if (items.length <= 1) {
    return [...items];
  }

  const regularItems: ChangeItem[] = [];
  const structuralItems: ChangeItem[] = [];

  for (const item of items) {
    if (isStructuralChangeItem(item)) {
      structuralItems.push(item);
    } else {
      regularItems.push(item);
    }
  }

  return [...regularItems, ...structuralItems];
}

export function remapIndicesAfterDeletion(
  paragraphIndices: number[],
  deletedIndices: number[]
): number[] {
  if (paragraphIndices.length === 0 || deletedIndices.length === 0) {
    return uniqueSorted(paragraphIndices);
  }

  const sortedDeleted = uniqueSorted(deletedIndices);
  const deletedSet = new Set(sortedDeleted);
  const remapped: number[] = [];

  for (const index of paragraphIndices) {
    if (deletedSet.has(index)) {
      continue;
    }
    let shift = 0;
    for (const deletedIndex of sortedDeleted) {
      if (deletedIndex < index) {
        shift += 1;
      } else {
        break;
      }
    }
    remapped.push(index - shift);
  }

  return uniqueSorted(remapped);
}

// ==================== 高层格式应用函数 ====================

/**
 * 将格式规范应用到整个文档
 */
export async function applyFormatSpecification(
  formatSpec: FormatSpecification,
  onProgress?: ProgressCallback
): Promise<void> {
  onProgress?.(0, 100, "正在获取段落信息...");
  const paragraphs = await getAllParagraphsInfo();
  onProgress?.(10, 100, "正在分类段落...");

  const paragraphsToFormat: Array<{
    index: number;
    type: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem";
  }> = [];

  for (const para of paragraphs) {
    if (!para.text.trim()) continue;
    let type: "heading1" | "heading2" | "heading3" | "bodyText" | "listItem";
    if (para.outlineLevel === 1) { type = "heading1"; }
    else if (para.outlineLevel === 2) { type = "heading2"; }
    else if (para.outlineLevel === 3) { type = "heading3"; }
    else if (para.isListItem) { type = "listItem"; }
    else { type = "bodyText"; }
    paragraphsToFormat.push({ index: para.index, type });
  }

  onProgress?.(20, 100, "正在应用格式...");
  await applyFormatToParagraphsBatch(formatSpec, paragraphsToFormat, 20, (current, total) => {
    const progress = 20 + Math.floor((current / total) * 80);
    onProgress?.(progress, 100, `正在应用格式 (${current}/${total})...`);
  });
  onProgress?.(100, 100, "格式应用完成");
}

/**
 * 分析并统一页眉页脚
 */
export async function unifyHeadersFooters(
  onProgress?: ProgressCallback
): Promise<HeaderFooterUnifyPlan> {
  onProgress?.(0, 3, "正在读取页眉页脚...");
  const headerFooters = await getSectionHeadersFooters();
  if (headerFooters.length === 0) {
    return { shouldUnify: false, reason: "文档没有节" };
  }
  onProgress?.(1, 3, "正在分析页眉页脚...");
  const plan = await callAIForHeaderFooterAnalysis(headerFooters);
  onProgress?.(2, 3, "正在应用统一方案...");
  if (plan.shouldUnify) {
    const safeHeader = typeof plan.headerText === "string"
      ? sanitizeMarkdownToPlainText(plan.headerText) : plan.headerText;
    const safeFooter = typeof plan.footerText === "string"
      ? sanitizeMarkdownToPlainText(plan.footerText) : plan.footerText;
    await applyHeaderFooterToAllSections(safeHeader, safeFooter);
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
  return { samples, paragraphCount: paragraphs.length, sectionCount: headerFooters.length };
}

/**
 * 应用颜色修正
 */
export async function applyColorAnalysisCorrections(
  colorAnalysis: ColorAnalysisItem[],
  onProgress?: ProgressCallback
): Promise<{ corrected: number; skipped: number }> {
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
  return { corrected: unreasonableItems.length, skipped: colorAnalysis.length - unreasonableItems.length };
}

// ==================== 操作日志 ====================

export function getOperationLogs(): OperationLogEntry[] {
  return [...operationLogs];
}

export async function addOperationLog(
  title: string, summary: string, scope: FormatScope, itemIds: string[] = []
): Promise<void> {
  const snapshot = await getDocumentOoxml();
  operationLogs.push({
    id: `op-${Date.now()}`, title, timestamp: Date.now(), scope, itemIds, summary, snapshot,
  });
}

export async function undoLastOptimization(): Promise<boolean> {
  const last = operationLogs.pop();
  if (!last) return false;
  await restoreDocumentOoxml(last.snapshot);
  return true;
}

// ==================== 批量变更应用 ====================

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
  const selectedItems = session.changePlan.items.filter((item) => selectedItemIds.includes(item.id));
  if (selectedItems.length === 0) return;
  const orderedItems = orderChangeItemsForExecution(selectedItems).map((item) => ({
    ...item,
    paragraphIndices: [...item.paragraphIndices],
  }));
  const executionItems = mergeTypographyChangeItems(orderedItems, options?.typographyOptions);

  const snapshot = await getDocumentOoxml();
  const needsContentChange = executionItems.some((item) => item.requiresContentChange);
  const beforeCheckpoint = await createContentCheckpoint();
  onProgress?.(0, executionItems.length, "正在应用优化...");

  // Import word operations used in switch cases
  const {
    applyHeaderFooterTemplate: applyHFTemplate,
    applyTypographyNormalization: applyTypoNorm,
    removeUnderline: rmUnderline,
    removeItalic: rmItalic,
    removeStrikethrough: rmStrikethrough,
  } = await import("./wordOperations");

  for (let i = 0; i < executionItems.length; i++) {
    if (cancelToken?.cancelled) { throw new Error("操作已取消"); }
    const item = executionItems[i];
    onProgress?.(i, executionItems.length, `正在处理：${item.title}`);

    try {
      switch (item.type) {
        case "heading-level-fix": {
          const levelChanges = (item.data?.levelChanges || []) as Array<{ index: number; level: number }>;
          await applyHeadingLevelFix(levelChanges);
          break;
        }
        case "heading-style": {
          const paragraphType = item.data?.paragraphType as "heading1" | "heading2" | "heading3";
          if (paragraphType && session.formatSpec) {
            await applyFormatToParagraphsBatch(
              session.formatSpec, item.paragraphIndices.map((index) => ({ index, type: paragraphType })), 20);
          }
          break;
        }
        case "body-style": {
          if (session.formatSpec) {
            await applyFormatToParagraphsBatch(
              session.formatSpec, item.paragraphIndices.map((index) => ({ index, type: "bodyText" })), 20);
          }
          break;
        }
        case "list-style": {
          if (session.formatSpec) {
            await applyFormatToParagraphsBatch(
              session.formatSpec, item.paragraphIndices.map((index) => ({ index, type: "listItem" })), 20);
          }
          break;
        }
        case "heading-numbering": {
          const numberingMap = (item.data?.numberingMap || []) as Array<{ index: number; newText: string }>;
          await applyHeadingNumbering(numberingMap);
          await updateTableOfContents();
          break;
        }
        case "table-style":
          await applyTableFormatting();
          break;
        case "caption-style": {
          const captionFixMap = (item.data?.captionFixMap || []) as Array<{ index: number; newText: string }>;
          await applyCaptionFormatting(captionFixMap);
          break;
        }
        case "image-alignment":
          await applyImageAlignment();
          break;
        case "header-footer-template": {
          const template = options?.headerFooterTemplate ||
            (item.data?.template as HeaderFooterTemplate) || defaultHeaderFooterTemplate;
          await applyHFTemplate(template);
          break;
        }
        case "color-correction": {
          const colorItems = (item.data?.colorItems as ColorAnalysisItem[]) || session.colorAnalysis;
          const selectedIndices = options?.colorSelections;
          const selectedItems = selectedIndices
            ? colorItems.filter((ci) => selectedIndices.includes(ci.paragraphIndex)) : colorItems;
          await applyColorAnalysisCorrections(selectedItems);
          break;
        }
        case "mixed-typography":
        case "punctuation-spacing": {
          const typography = mergeTypographyOptions([item], options?.typographyOptions);
          if (item.type === "punctuation-spacing") {
            typography.enforceSpacing = true;
            typography.enforcePunctuation = true;
          }
          await applyTypoNorm(item.paragraphIndices, typography);
          break;
        }
        case "pagination-control": {
          const paginationResult = await applyPaginationControl(item.paragraphIndices);
          if (paginationResult.deletedIndices.length > 0) {
            for (let j = i + 1; j < executionItems.length; j++) {
              executionItems[j].paragraphIndices = remapIndicesAfterDeletion(
                executionItems[j].paragraphIndices,
                paginationResult.deletedIndices
              );
            }
          }
          break;
        }
        case "special-content":
          await applySpecialContentFormatting(item.paragraphIndices);
          break;
        case "underline-removal":
          await rmUnderline(item.paragraphIndices);
          break;
        case "italic-removal":
          await rmItalic(item.paragraphIndices);
          break;
        case "strikethrough-removal":
          await rmStrikethrough(item.paragraphIndices);
          break;
        default:
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`应用变更「${item.title}」失败: ${message}`);
    }
  }

  onProgress?.(executionItems.length, executionItems.length, "优化完成");

  const afterCheckpoint = await createContentCheckpoint();
  const integrityResult = verifyContentIntegrity(beforeCheckpoint, afterCheckpoint);
  if (!integrityResult.valid && !needsContentChange) {
    throw new Error(`内容完整性校验失败: ${integrityResult.error}`);
  }

  const summary = executionItems.map((item) => item.title).join("、");
  const summaryWithIntegrity = !integrityResult.valid && needsContentChange
    ? `${summary}（内容校验提示：${integrityResult.error}）` : summary;

  const executedItemIds = Array.from(new Set(executionItems.flatMap((item) => {
    const mergedIds = item.data?.mergedChangeIds;
    if (Array.isArray(mergedIds)) {
      return mergedIds.filter((id): id is string => typeof id === "string");
    }
    return [item.id];
  })));

  operationLogs.push({
    id: `batch-${Date.now()}`, title: "批次优化", timestamp: Date.now(),
    scope: session.scope, itemIds: executedItemIds,
    summary: summaryWithIntegrity, snapshot,
  });
}
