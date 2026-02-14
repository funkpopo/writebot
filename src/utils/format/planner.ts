/**
 * AI排版服务 - 变更计划生成
 * 生成格式变更计划、标题编号映射、题注修复映射等
 */

import {
  ParagraphInfo,
  FormatSpecification,
  sampleDocumentFormats,
  getAllParagraphsInfo,
  getSectionHeadersFooters,
  getParagraphIndicesInSelection,
  getParagraphIndicesInCurrentSection,
} from "../wordApi";
import {
  FormatAnalysisResult,
  ColorAnalysisItem,
  FormatMarkAnalysisItem,
  FormatScope,
  IssueCategory,
  ChangePlan,
  ChangeItem,
  FormatAnalysisSession,
  ProgressCallback,
  CancelToken,
} from "./types";
import {
  uniqueSorted,
  filterParagraphsByIndices,
  stripHeadingNumber,
  findCaptionParagraphs,
  makeChangeItem,
  defaultTypographyOptions,
  defaultHeaderFooterTemplate,
} from "./utils";
import { detectHeadingLevelFixes } from "./detectors";
import {
  detectHierarchyIssues,
  detectListInBodyIssues,
  detectHeadingConsistencyIssues,
  detectBodyConsistencyIssues,
  detectListConsistencyIssues,
  detectColorHighlightIssues,
  detectMixedTypographyIssues,
  detectPunctuationIssues,
  detectPaginationIssues,
  detectHeaderFooterIssues,
  detectTableIssues,
  detectCaptionIssues,
  detectSpecialContentIssues,
  detectUnderlineIssues,
  detectItalicIssues,
  detectStrikethroughIssues,
} from "./detectors";
import { callAIForFormatAnalysis } from "./aiIntegration";

/**
 * 分析文档格式并生成统一规范
 */
export async function analyzeAndGenerateFormatSpec(
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal
): Promise<FormatAnalysisResult> {
  onProgress?.(0, 3, "正在采样文档格式...");
  const samples = await sampleDocumentFormats(5);
  if (abortSignal?.aborted) {
    throw new Error("操作已取消");
  }
  onProgress?.(1, 3, "正在分析格式...");
  const result = await callAIForFormatAnalysis(samples, abortSignal);
  onProgress?.(3, 3, "分析完成");
  return result;
}

export function buildHeadingNumberingMap(
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

export function buildCaptionFixMap(
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

export function buildChangePlan(
  paragraphs: ParagraphInfo[],
  formatSpec: FormatSpecification | null,
  colorAnalysis: ColorAnalysisItem[],
  formatMarkAnalysis: FormatMarkAnalysisItem[] = []
): ChangePlan {
  const items: ChangeItem[] = [];
  const hasFormatSpec = !!formatSpec && Object.keys(formatSpec).length > 0;
  const headings = paragraphs.filter((p) => p.outlineLevel && p.outlineLevel > 0);
  const body = paragraphs.filter((p) => !p.outlineLevel && !p.isListItem);
  const listItems = paragraphs.filter((p) => p.isListItem);

  const headingFixes = detectHeadingLevelFixes(headings);
  if (headingFixes.length > 0) {
    items.push(makeChangeItem("heading-level-fix", "修复标题层级",
      `修复 ${headingFixes.length} 处标题跳级`, "heading-level-fix",
      headingFixes.map((f) => f.index), { levelChanges: headingFixes }));
  }

  if (hasFormatSpec) {
    for (const level of [1, 2, 3]) {
      const levelHeadings = headings.filter((p) => p.outlineLevel === level);
      if (levelHeadings.length === 0) continue;
      const paragraphType = `heading${level}` as "heading1" | "heading2" | "heading3";
      if (!formatSpec?.[paragraphType]) continue;
      items.push(makeChangeItem(`heading-style-${level}`, `统一${level}级标题样式`,
        `按方案应用 ${level}级标题样式`, "heading-style",
        levelHeadings.map((p) => p.index), { paragraphType }));
    }
  }

  if (hasFormatSpec && body.length > 0 && formatSpec?.bodyText) {
    items.push(makeChangeItem("body-style", "统一正文样式",
      "按方案应用正文段落字体与段落格式", "body-style",
      body.map((p) => p.index), { paragraphType: "bodyText" }));
  }

  if (hasFormatSpec && listItems.length > 0 && formatSpec?.listItem) {
    items.push(makeChangeItem("list-style", "统一列表样式",
      "按方案应用列表缩进与间距", "list-style",
      listItems.map((p) => p.index), { paragraphType: "listItem" }));
  }

  if (headings.length > 0) {
    const numberingMap = buildHeadingNumberingMap(headings);
    if (numberingMap.length > 0) {
      items.push(makeChangeItem("heading-numbering", "标题自动编号并更新目录",
        "生成多级标题编号并更新目录", "heading-numbering",
        numberingMap.map((item) => item.index), { numberingMap }, true));
    }
  }

  if (colorAnalysis.length > 0) {
    const unreasonable = colorAnalysis.filter((item) => !item.isReasonable);
    if (unreasonable.length > 0) {
      items.push(makeChangeItem("color-correction", "颜色标识治理",
        `修正 ${unreasonable.length} 处不合理颜色`, "color-correction",
        unreasonable.map((item) => item.paragraphIndex), { colorItems: unreasonable }));
    }
  }

  const captions = findCaptionParagraphs(paragraphs);
  if (captions.length > 0) {
    const captionFixMap = buildCaptionFixMap(captions);
    items.push(makeChangeItem("caption-style", "图/表题注统一",
      "统一题注样式与编号", "caption-style",
      captions.map((c) => c.index), { captionFixMap }, true));
  }

  items.push(makeChangeItem("table-style", "表格样式统一",
    "统一表头行、边框、对齐与行高", "table-style", []));
  items.push(makeChangeItem("image-alignment", "图片/图表对齐规范",
    "统一图片与正文的对齐和间距", "image-alignment", []));
  items.push(makeChangeItem("header-footer-template", "页眉页脚模板增强",
    "统一页眉页脚并支持首页/奇偶页与字段", "header-footer-template",
    [], { template: defaultHeaderFooterTemplate }));
  items.push(makeChangeItem("mixed-typography", "中英混排规范",
    "统一中英文间距与字体映射", "mixed-typography",
    paragraphs.map((p) => p.index), { typography: defaultTypographyOptions }, true));
  items.push(makeChangeItem("punctuation-spacing", "标点与空格规范",
    "修正中文标点后空格、英文标点前空格等问题", "punctuation-spacing",
    paragraphs.map((p) => p.index),
    { typography: { ...defaultTypographyOptions, enforceSpacing: true, enforcePunctuation: true } }, true));
  items.push(makeChangeItem("special-content", "特殊内容格式统一",
    "统一引用、代码、术语等特殊内容格式", "special-content",
    paragraphs.map((p) => p.index), {}));

  // 基于AI分析结果处理下划线、斜体、删除线
  const unreasonableUnderlines = formatMarkAnalysis
    .filter((item) => item.formatType === "underline" && !item.shouldKeep)
    .map((item) => item.paragraphIndex);
  const unreasonableItalics = formatMarkAnalysis
    .filter((item) => item.formatType === "italic" && !item.shouldKeep)
    .map((item) => item.paragraphIndex);
  const unreasonableStrikethroughs = formatMarkAnalysis
    .filter((item) => item.formatType === "strikethrough" && !item.shouldKeep)
    .map((item) => item.paragraphIndex);
  const keptUnderlines = formatMarkAnalysis.filter(
    (item) => item.formatType === "underline" && item.shouldKeep).length;
  const keptItalics = formatMarkAnalysis.filter(
    (item) => item.formatType === "italic" && item.shouldKeep).length;
  const keptStrikethroughs = formatMarkAnalysis.filter(
    (item) => item.formatType === "strikethrough" && item.shouldKeep).length;

  if (unreasonableUnderlines.length > 0) {
    const description = keptUnderlines > 0
      ? `清除 ${unreasonableUnderlines.length} 处不合理下划线（保留 ${keptUnderlines} 处合理使用）`
      : `清除 ${unreasonableUnderlines.length} 个段落的下划线格式`;
    items.push(makeChangeItem("underline-removal", "智能清除下划线", description,
      "underline-removal", unreasonableUnderlines,
      { formatMarkItems: formatMarkAnalysis.filter((item) => item.formatType === "underline") }));
  }

  if (unreasonableItalics.length > 0) {
    const description = keptItalics > 0
      ? `清除 ${unreasonableItalics.length} 处不合理斜体（保留 ${keptItalics} 处合理使用）`
      : `清除 ${unreasonableItalics.length} 个段落的斜体格式`;
    items.push(makeChangeItem("italic-removal", "智能清除斜体", description,
      "italic-removal", unreasonableItalics,
      { formatMarkItems: formatMarkAnalysis.filter((item) => item.formatType === "italic") }));
  }

  if (unreasonableStrikethroughs.length > 0) {
    const description = keptStrikethroughs > 0
      ? `清除 ${unreasonableStrikethroughs.length} 处不合理删除线（保留 ${keptStrikethroughs} 处合理使用）`
      : `清除 ${unreasonableStrikethroughs.length} 个段落的删除线格式`;
    items.push(makeChangeItem("strikethrough-removal", "智能清除删除线", description,
      "strikethrough-removal", unreasonableStrikethroughs,
      { formatMarkItems: formatMarkAnalysis.filter((item) => item.formatType === "strikethrough") }));
  }

  items.push(makeChangeItem("pagination-control", "段落分页控制",
    "设置标题与下段同页，清理分页符与空行", "pagination-control",
    paragraphs.map((p) => p.index), {}, true));

  return { items, formatSpec };
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

  const headings = scopedParagraphs.filter((p) => p.outlineLevel && p.outlineLevel > 0);
  const body = scopedParagraphs.filter((p) => !p.outlineLevel && !p.isListItem);
  const listItems = scopedParagraphs.filter((p) => p.isListItem);

  const issues: IssueCategory[] = [];

  const hierarchyIssues = [...detectHierarchyIssues(headings), ...detectListInBodyIssues(scopedParagraphs)];
  issues.push({ id: "hierarchy", title: "段落层级检测", summary: `${hierarchyIssues.length} 项`, items: hierarchyIssues });

  const headingIssues = [
    ...detectHeadingConsistencyIssues(headings, 1),
    ...detectHeadingConsistencyIssues(headings, 2),
    ...detectHeadingConsistencyIssues(headings, 3),
  ];
  issues.push({ id: "heading-consistency", title: "标题一致性", summary: `${headingIssues.length} 项`, items: headingIssues });

  const bodyIssues = detectBodyConsistencyIssues(body);
  issues.push({ id: "body-consistency", title: "正文一致性", summary: `${bodyIssues.length} 项`, items: bodyIssues });

  const listIssues = detectListConsistencyIssues(listItems);
  issues.push({ id: "list-consistency", title: "列表规范", summary: `${listIssues.length} 项`, items: listIssues });

  const colorIssues = detectColorHighlightIssues(scopedParagraphs);
  issues.push({ id: "color-highlight", title: "颜色与高亮", summary: `${colorIssues.length} 项`, items: colorIssues });

  const mixedIssues = detectMixedTypographyIssues(scopedParagraphs);
  issues.push({ id: "mixed-typography", title: "中英混排", summary: `${mixedIssues.length} 项`, items: mixedIssues });

  const punctuationIssues = detectPunctuationIssues(scopedParagraphs);
  issues.push({ id: "punctuation-spacing", title: "标点与空格", summary: `${punctuationIssues.length} 项`, items: punctuationIssues });

  const paginationIssues = detectPaginationIssues(scopedParagraphs);
  issues.push({ id: "pagination-control", title: "分页控制", summary: `${paginationIssues.length} 项`, items: paginationIssues });

  const headerFooterIssues = await detectHeaderFooterIssues();
  issues.push({ id: "header-footer", title: "页眉页脚差异", summary: `${headerFooterIssues.length} 项`, items: headerFooterIssues });

  const tableIssues = await detectTableIssues();
  issues.push({ id: "table-style", title: "表格规范", summary: `${tableIssues.length} 项`, items: tableIssues });

  const captionIssues = detectCaptionIssues(scopedParagraphs);
  issues.push({ id: "caption-style", title: "图/表题注", summary: `${captionIssues.length} 项`, items: captionIssues });

  const specialIssues = detectSpecialContentIssues(scopedParagraphs);
  issues.push({ id: "special-content", title: "特殊内容", summary: `${specialIssues.length} 项`, items: specialIssues });

  const underlineIssues = detectUnderlineIssues(scopedParagraphs);
  issues.push({ id: "underline", title: "下划线", summary: `${underlineIssues.length} 项`, items: underlineIssues });

  const italicIssues = detectItalicIssues(scopedParagraphs);
  issues.push({ id: "italic", title: "斜体", summary: `${italicIssues.length} 项`, items: italicIssues });

  const strikethroughIssues = detectStrikethroughIssues(scopedParagraphs);
  issues.push({ id: "strikethrough", title: "删除线", summary: `${strikethroughIssues.length} 项`, items: strikethroughIssues });

  checkCancelled();
  onProgress?.(4, 6, "正在生成优化方案...");

  const changePlan = buildChangePlan(scopedParagraphs, formatSpec, colorAnalysis, formatMarkAnalysis);

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
