import { describe, expect, it } from "bun:test";
import type { DocumentIndex, DocumentIndexParagraph, DocumentRangeAnchor } from "../../../../../utils/wordApi";
import {
  DocumentSession,
  renderDocumentIndexSummary,
} from "../documentSession";
import type { ArticleOutline, SectionWriteResult } from "../types";

function anchor(index: number, textHash: string, headingPath: string[]): DocumentRangeAnchor {
  return {
    anchorId: `p${index}_${textHash}`,
    paragraphIndex: index,
    paragraphTextHash: textHash,
    normalizedExcerpt: `p${index}`,
    headingPath,
    occurrence: 1,
  };
}

function paragraph(params: {
  index: number;
  kind?: DocumentIndexParagraph["kind"];
  textHash?: string;
  preview?: string;
  outlineLevel?: number;
  headingPath?: string[];
}): DocumentIndexParagraph {
  const textHash = params.textHash || `h${params.index}`;
  const headingPath = params.headingPath || [];
  return {
    index: params.index,
    kind: params.kind || "body",
    outlineLevel: params.outlineLevel,
    headingPath,
    charStart: params.index * 10,
    charEnd: params.index * 10 + (params.preview?.length || 0),
    textLength: params.preview?.length || 0,
    textHash,
    preview: params.preview || "",
    anchor: anchor(params.index, textHash, headingPath),
  };
}

function buildFakeIndex(): DocumentIndex {
  const paragraphs = [
    paragraph({ index: 0, kind: "empty", preview: "" }),
    paragraph({ index: 1, kind: "body", preview: "# 测试文章" }),
    paragraph({ index: 2, kind: "body", preview: "## 第一节", headingPath: ["第一节"], outlineLevel: 2 }),
    paragraph({ index: 3, preview: "第一节正文", headingPath: ["第一节"] }),
    paragraph({ index: 4, kind: "body", preview: "## 第二节", headingPath: ["第二节"], outlineLevel: 2 }),
    paragraph({ index: 5, preview: "第二节正文", headingPath: ["第二节"] }),
  ];
  return {
    version: 1,
    createdAt: "2026-06-03T00:00:00.000Z",
    paragraphCount: paragraphs.length,
    totalCharCount: paragraphs.reduce((sum, item) => sum + item.textLength, 0),
    headingCount: 0,
    listItemCount: 0,
    tableCount: 0,
    headerFooterCount: 0,
    paragraphs,
    headings: [],
    lists: [],
    tables: [],
    headersFooters: [],
  };
}

const outline: ArticleOutline = {
  title: "测试文章",
  theme: "测试主题",
  targetAudience: "测试读者",
  style: "专业",
  sections: [
    {
      id: "s1",
      title: "第一节",
      level: 1,
      description: "覆盖第一节",
      keyPoints: ["要点 A"],
      estimatedParagraphs: 2,
    },
    {
      id: "s2",
      title: "第二节",
      level: 1,
      description: "覆盖第二节",
      keyPoints: ["要点 B"],
      estimatedParagraphs: 2,
    },
  ],
  totalEstimatedParagraphs: 4,
  primaryGoal: "生成测试文章",
  hardConstraints: ["不要写引言"],
  outputRequirements: { language: "zh-CN" },
};

describe("DocumentSession", () => {
  it("renders planner-safe document index summary without full document text", () => {
    const session = new DocumentSession("docsess_test", buildFakeIndex());
    const summary = renderDocumentIndexSummary(session.getSummary());

    expect(summary).toContain("Document Index Session");
    expect(summary).toContain("paragraphCount: 6");
    expect(summary).toContain("局部预览");
    expect(summary).not.toContain("第一节正文\n第二节正文");
  });

  it("resolves markdown heading-like paragraphs as section ranges", () => {
    const session = new DocumentSession("docsess_test", buildFakeIndex());

    expect(session.resolveSectionRange("第一节", "第二节")).toEqual({
      start: 2,
      end: 3,
      heading: { index: 2, level: 2 },
    });
    expect(session.getLastParagraph()?.index).toBe(5);
  });

  it("builds ReviewContextBundle from written section cache and index anchors", () => {
    const session = new DocumentSession("docsess_test", buildFakeIndex());
    const writtenSections: SectionWriteResult[] = [
      {
        sectionId: "s1",
        sectionTitle: "第一节",
        content: "第一节正文",
        sourceAnchors: ["p3"],
        range: {
          startParagraphIndex: 2,
          endParagraphIndex: 3,
          paragraphCount: 2,
          transactionIds: ["tx_s1"],
        },
      },
      {
        sectionId: "s2",
        sectionTitle: "第二节",
        content: "第二节正文",
        sourceAnchors: ["p5"],
        range: {
          startParagraphIndex: 4,
          endParagraphIndex: 5,
          paragraphCount: 2,
          transactionIds: ["tx_s2"],
        },
      },
    ];

    const bundle = session.buildReviewContextBundle(outline, writtenSections, ["s2"]);

    expect(bundle.sectionBundles).toHaveLength(2);
    expect(bundle.changedSectionIds).toEqual(["s2"]);
    expect(bundle.sectionBundles[0].range).toEqual({
      startParagraphIndex: 2,
      endParagraphIndex: 3,
      paragraphCount: 2,
    });
    expect(bundle.sectionBundles[0].headingAnchor?.paragraphIndex).toBe(2);
    expect(bundle.knownFacts).toContain("第一节: p3");
  });

  it("throws when a cached written section has no transaction range", () => {
    const session = new DocumentSession("docsess_test", buildFakeIndex());
    const brokenOutline: ArticleOutline = {
      ...outline,
      sections: [{ ...outline.sections[0], id: "missing", title: "不存在章节" }],
    };

    expect(() => session.buildReviewContextBundle(
      brokenOutline,
      [{ sectionId: "missing", sectionTitle: "不存在章节", content: "正文" }],
    )).toThrow("章节缺少已提交 transaction range");
  });
});
