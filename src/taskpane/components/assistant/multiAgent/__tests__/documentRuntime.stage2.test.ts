import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ToolExecutor } from "../../../../../utils/toolExecutor";
import { saveEditTransactionRecord } from "../../../../../utils/storageService";
import type { EditTransaction } from "../../../../../utils/editTransactionTypes";
import { AgentHarnessError, AgentHarnessRuntime, createAgentRunTrace } from "../agentHarness";
import { buildReviewContext } from "../contextBuilder";
import type { DocumentSession, ReviewContextBundle } from "../documentSession";
import { readDocumentText, resolveWrittenSectionFromTransaction } from "../documentRuntime";

async function readSource(relativePath: string): Promise<string> {
  const response = await fetch(new URL(relativePath, import.meta.url));
  return response.text();
}

const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

function installStorageMock(): void {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: createStorageMock(),
  });
}

function restoreStorageMock(): void {
  if (originalSessionStorageDescriptor) {
    Object.defineProperty(globalThis, "sessionStorage", originalSessionStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
}

function committedTransaction(
  content: string,
  options: {
    id?: string;
    startParagraphIndex?: number;
    endParagraphIndex?: number;
  } = {},
): EditTransaction {
  const startParagraphIndex = options.startParagraphIndex ?? 2;
  const endParagraphIndex = options.endParagraphIndex ?? startParagraphIndex;
  return {
    id: options.id || "tx_stage2_replay",
    source: "agent_tool",
    operationGroupId: "group_stage2",
    operation: {
      type: "insert_at_anchor",
      content,
      contentFormat: "markdown",
    },
    scope: { kind: "paragraph_anchor", anchorParagraphIndex: 1 },
    expectedBefore: {
      paragraphIndex: 1,
      paragraphTextHash: "hash_before",
    },
    after: {
      text: content,
      textHash: "hash_after",
      excerpt: content,
      paragraphCount: 1,
      paragraphIndices: [startParagraphIndex],
      startParagraphIndex,
      endParagraphIndex,
      paragraphTexts: [content],
    },
    status: "committed",
    createdAt: "2026-06-03T00:00:00.000Z",
    committedAt: "2026-06-03T00:00:01.000Z",
  };
}

describe("Document Index Session stage 2 contract", () => {
  beforeEach(() => {
    installStorageMock();
  });

  afterEach(() => {
    restoreStorageMock();
  });

  it("throws a structured error for full document reads in the agent pipeline", async () => {
    const harness = new AgentHarnessRuntime(createAgentRunTrace("run_forbidden_read", "写一篇文章"));

    await expect(readDocumentText(harness, { phase: "test" })).rejects.toThrow(AgentHarnessError);

    const failedRead = harness.getTrace().events.find((event) => event.kind === "document_read_failed");
    expect(failedRead?.metadata?.code).toBe("forbidden_full_document_read");
  });

  it("does not use full-text replay validation", async () => {
    const executor = new ToolExecutor();
    const result = await executor.validateNormalizedWriteReplay(
      "这是一段足够长的历史写入内容，用于确认 replay 校验不会扫描全文。",
    );

    expect(result.status).toBe("unsupported");
    expect(result.message).toContain("禁止通过全文扫描校验重放");
  });

  it("matches replay validation from committed transaction ledger without full-text reads", async () => {
    const content = "这是一段已经通过结构化事务写入的内容，用于验证 replay ledger。";
    await saveEditTransactionRecord(committedTransaction(content));

    const executor = new ToolExecutor();
    const result = await executor.validateNormalizedWriteReplay(content);

    expect(result.status).toBe("matched");
    expect(result.message).toContain("transaction ledger 已匹配已提交写入");
  });

  it("resolves after-write content from the committed transaction range without heading lookup", async () => {
    const content = "冬日残冰在檐角滴落最后一串晶莹，枯黄草根下已钻出鹅黄的嫩芽。";
    await saveEditTransactionRecord(committedTransaction(content, {
      id: "tx_after_write_range",
      startParagraphIndex: 5,
      endParagraphIndex: 5,
    }));

    const harness = new AgentHarnessRuntime(createAgentRunTrace("run_after_write_range", "写春天短文"));
    let readInput: unknown;
    const fakeSession = {
      readRanges: async (_harness: AgentHarnessRuntime, input: unknown) => {
        readInput = input;
        return [{
          rangeId: "p5-p5",
          startParagraphIndex: 5,
          endParagraphIndex: 5,
          paragraphCount: 1,
          text: content,
          paragraphs: [{
            index: 5,
            text: content,
            textHash: "hash_after",
            isListItem: false,
            headingPath: [],
            anchor: {
              anchorId: "p5_hash_after",
              paragraphIndex: 5,
              paragraphTextHash: "hash_after",
              normalizedExcerpt: content,
              headingPath: [],
              occurrence: 1,
            },
          }],
        }];
      },
      readSectionByHeading: () => {
        throw new Error("heading lookup must not be used for after-write resolution");
      },
    } as unknown as DocumentSession;

    const resolution = await resolveWrittenSectionFromTransaction({
      session: fakeSession,
      harness,
      section: {
        id: "s1",
        title: "春的初临",
        level: 1,
        description: "描写春天初来的景象",
        keyPoints: ["春意"],
        estimatedParagraphs: 1,
      },
      toolResults: [{
        id: "insert_s1",
        name: "insert_at_anchor",
        success: true,
        result: { transactionId: "tx_after_write_range" },
      }],
      metadata: { phase: "writing", moment: "after_write" },
    });

    expect(resolution.transactionIds).toEqual(["tx_after_write_range"]);
    expect(resolution.range.text).toBe(content);
    expect(readInput).toEqual({
      ranges: [{ start: 5, end: 5 }],
      maxParagraphs: 1,
    });
  });

  it("keeps core agent pipeline files free of full-document read imports and full-text review prompts", async () => {
    const files = [
      "../orchestrator.ts",
      "../sectionWriteFlow.ts",
      "../qualityGate.ts",
      "../reviewConsensus.ts",
      "../reviewerAgent.ts",
      "../contextBuilder.ts",
    ];

    for (const file of files) {
      const source = await readSource(file);
      expect(source).not.toContain("readDocumentText");
      expect(source).not.toContain("当前文档全文");
    }
  });

  it("keeps review prompts bounded by section bundles instead of 500 paragraph previews", () => {
    const fullDocumentPreviewMarkers = Array.from({ length: 500 }, (_, index) =>
      `full_body_marker_${index.toString().padStart(3, "0")}_${"x".repeat(120)}`
    );
    const reviewBundle: ReviewContextBundle = {
      outlineSummary: {
        title: "长文档审阅测试",
        theme: "阶段二",
        targetAudience: "内部测试",
        style: "专业",
      },
      promptContract: {
        primaryGoal: "审阅已写章节",
        hardConstraints: ["不得读取全文"],
        outputRequirements: { language: "zh-CN" },
      },
      sectionBundles: [
        {
          sectionId: "s1",
          sectionTitle: "第一节",
          outlineDescription: "只审阅局部章节",
          keyPoints: ["要点 A"],
          content: "第一节局部正文。".repeat(60),
          sourceAnchors: ["p10"],
          headingAnchor: {
            paragraphIndex: 10,
            paragraphTextHash: "hash_s1",
            headingPath: ["第一节"],
          },
          range: {
            startParagraphIndex: 10,
            endParagraphIndex: 14,
            paragraphCount: 5,
          },
          beforePreview: "前文局部预览",
          afterPreview: "后文局部预览",
        },
        {
          sectionId: "s2",
          sectionTitle: "第二节",
          outlineDescription: "只审阅局部章节",
          keyPoints: ["要点 B"],
          content: "第二节局部正文。".repeat(60),
          sourceAnchors: ["p20"],
          headingAnchor: {
            paragraphIndex: 20,
            paragraphTextHash: "hash_s2",
            headingPath: ["第二节"],
          },
          range: {
            startParagraphIndex: 20,
            endParagraphIndex: 25,
            paragraphCount: 6,
          },
        },
      ],
      changedSectionIds: ["s2"],
      knownFacts: ["第一节: p10", "第二节: p20"],
      indexSummary: {
        sessionId: "docsess_500",
        indexVersion: 3,
        paragraphCount: 500,
        totalCharCount: fullDocumentPreviewMarkers.join("\n").length,
        headingCount: 40,
        listItemCount: 0,
        tableCount: 0,
        headings: fullDocumentPreviewMarkers.slice(0, 40).map((marker, index) => ({
          index,
          level: 1,
          text: marker,
          headingPath: [marker],
        })),
        previews: fullDocumentPreviewMarkers.map((marker, index) => ({
          index,
          kind: "body",
          preview: marker,
          headingPath: [],
        })),
      },
    };

    const prompt = buildReviewContext(reviewBundle, 1);
    const fullPreviewChars = fullDocumentPreviewMarkers.join("\n").length;

    expect(prompt).toContain("paragraphCount: 500");
    expect(prompt).toContain("第一节局部正文");
    expect(prompt).toContain("第二节局部正文");
    expect(prompt).not.toContain("full_body_marker_499");
    expect(prompt.length).toBeLessThan(fullPreviewChars / 4);
  });
});
