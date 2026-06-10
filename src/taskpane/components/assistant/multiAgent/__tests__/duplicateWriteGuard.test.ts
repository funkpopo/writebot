import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { stableTextHash } from "../../../../../utils/documentText";
import { saveEditTransactionRecord } from "../../../../../utils/storageService";
import type { EditTransaction } from "../../../../../utils/editTransactionTypes";
import type {
  DocumentIndex,
  DocumentIndexParagraph,
  DocumentRangeAnchor,
  DocumentRangeReadResult,
} from "../../../../../utils/wordApi";
import { DocumentSession } from "../documentSession";
import type { OutlineSection, SectionWriteResult } from "../types";
import {
  buildInsertAtAnchorToolCall,
  buildReplaceRangeToolCall,
  checkDuplicateWriteGuard,
} from "../writerWriteGuards";

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

const section: OutlineSection = {
  id: "s1",
  title: "第一节",
  level: 1,
  description: "覆盖第一节",
  keyPoints: ["要点 A"],
  estimatedParagraphs: 2,
};

function anchor(index: number, text: string, headingPath: string[] = []): DocumentRangeAnchor {
  const textHash = stableTextHash(text);
  return {
    anchorId: `p${index}_${textHash}`,
    paragraphIndex: index,
    paragraphTextHash: textHash,
    normalizedExcerpt: text,
    headingPath,
    occurrence: 1,
  };
}

function paragraph(params: {
  index: number;
  text: string;
  kind?: DocumentIndexParagraph["kind"];
  outlineLevel?: number;
  headingPath?: string[];
}): DocumentIndexParagraph {
  const headingPath = params.headingPath || [];
  const textHash = stableTextHash(params.text);
  return {
    index: params.index,
    kind: params.kind || "body",
    outlineLevel: params.outlineLevel,
    headingPath,
    charStart: params.index * 10,
    charEnd: params.index * 10 + params.text.length,
    textLength: params.text.length,
    textHash,
    preview: params.text,
    anchor: anchor(params.index, params.text, headingPath),
  };
}

function session(paragraphs: DocumentIndexParagraph[]): DocumentSession {
  const index: DocumentIndex = {
    version: 1,
    createdAt: "2026-06-10T00:00:00.000Z",
    paragraphCount: paragraphs.length,
    totalCharCount: paragraphs.reduce((sum, item) => sum + item.textLength, 0),
    headingCount: paragraphs.filter((item) => item.kind === "heading").length,
    listItemCount: 0,
    tableCount: 0,
    headerFooterCount: 0,
    paragraphs,
    headings: [],
    lists: [],
    tables: [],
    headersFooters: [],
  };
  return new DocumentSession("docsess_writer_guard", index);
}

function targetRange(text: string): DocumentRangeReadResult {
  const first = paragraph({ index: 2, text: "## 第一节", kind: "heading", outlineLevel: 2, headingPath: ["第一节"] });
  const second = paragraph({ index: 3, text, headingPath: ["第一节"] });
  return {
    rangeId: "p2-p3",
    startParagraphIndex: 2,
    endParagraphIndex: 3,
    paragraphCount: 2,
    text: [first.preview, second.preview].join("\n"),
    paragraphs: [
      {
        index: first.index,
        text: first.preview || "",
        textHash: first.textHash,
        outlineLevel: first.outlineLevel,
        isListItem: false,
        headingPath: first.headingPath,
        anchor: first.anchor,
      },
      {
        index: second.index,
        text: second.preview || "",
        textHash: second.textHash,
        isListItem: false,
        headingPath: second.headingPath,
        anchor: second.anchor,
      },
    ],
  };
}

function committedTransaction(overrides: {
  id?: string;
  operationGroupId: string;
  content: string;
}): EditTransaction {
  return {
    id: overrides.id || "tx_guard",
    source: "agent_tool",
    operationGroupId: overrides.operationGroupId,
    operation: {
      type: "insert_at_anchor",
      content: overrides.content,
      contentFormat: "markdown",
    },
    scope: { kind: "paragraph_anchor", anchorParagraphIndex: 1 },
    expectedBefore: {
      paragraphIndex: 1,
      paragraphTextHash: stableTextHash("锚点"),
    },
    after: {
      text: overrides.content,
      textHash: stableTextHash(overrides.content),
      excerpt: overrides.content,
      paragraphCount: 3,
      startParagraphIndex: 2,
      endParagraphIndex: 4,
      paragraphTexts: overrides.content.split("\n"),
    },
    status: "committed",
    createdAt: "2026-06-10T00:00:00.000Z",
    committedAt: "2026-06-10T00:00:01.000Z",
  };
}

describe("duplicateWriteGuard", () => {
  beforeEach(() => {
    installStorageMock();
  });

  afterEach(() => {
    restoreStorageMock();
  });

  it("blocks exact duplicate new-section content from runtime section cache", async () => {
    const text = "## 第一节\n\n已经写入的正文。";
    const documentSession = session([
      paragraph({ index: 0, text: "" }),
      paragraph({ index: 1, text: "锚点" }),
    ]);
    const writtenSections: SectionWriteResult[] = [{
      sectionId: section.id,
      sectionTitle: section.title,
      content: "第一节\n\n已经写入的正文。",
    }];

    const result = await checkDuplicateWriteGuard({
      mode: "new_section",
      section,
      text,
      documentSession,
      writtenSections,
      writtenSegments: [],
      anchorParagraph: documentSession.getLastParagraph(),
    });

    expect(result.status).toBe("duplicate");
    expect(result.code).toBe("duplicate_write_detected");
    expect(result.matchedBy).toBe("runtime_section_cache");
  });

  it("treats a same-title existing section with different content as a conflict", async () => {
    const documentSession = session([
      paragraph({ index: 0, text: "# 测试文章" }),
      paragraph({ index: 1, text: "## 第一节", kind: "heading", outlineLevel: 2, headingPath: ["第一节"] }),
      paragraph({ index: 2, text: "已有但不同的正文", headingPath: ["第一节"] }),
    ]);

    const result = await checkDuplicateWriteGuard({
      mode: "new_section",
      section,
      text: "## 第一节\n\n新的正文，不应继续追加。",
      documentSession,
      writtenSections: [],
      writtenSegments: [],
      anchorParagraph: documentSession.getLastParagraph(),
    });

    expect(result.status).toBe("conflict");
    expect(result.code).toBe("tool_contract_violation");
    expect(result.message).toContain("同名章节标题");
  });

  it("detects duplicate committed operation groups from transaction ledger", async () => {
    const documentSession = session([
      paragraph({ index: 0, text: "" }),
      paragraph({ index: 1, text: "锚点" }),
    ]);
    const text = "## 第一节\n\nledger 已提交正文。";
    const clear = await checkDuplicateWriteGuard({
      mode: "new_section",
      section,
      text,
      documentSession,
      writtenSections: [],
      writtenSegments: [],
      anchorParagraph: documentSession.getLastParagraph(),
    });
    await saveEditTransactionRecord(committedTransaction({
      operationGroupId: clear.fingerprint.operationGroupId,
      content: text,
    }));

    const duplicate = await checkDuplicateWriteGuard({
      mode: "new_section",
      section,
      text,
      documentSession,
      writtenSections: [],
      writtenSegments: [],
      anchorParagraph: documentSession.getLastParagraph(),
    });

    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.matchedBy).toBe("transaction_ledger");
    expect(duplicate.transactionId).toBe("tx_guard");
  });

  it("builds deterministic insert and replace tool calls with expectedBefore evidence", () => {
    const documentSession = session([
      paragraph({ index: 0, text: "" }),
      paragraph({ index: 1, text: "锚点" }),
    ]);
    const lastParagraph = documentSession.getLastParagraph();
    expect(lastParagraph).not.toBeNull();

    const insert = buildInsertAtAnchorToolCall({
      section,
      text: "## 第一节\n\n正文。",
      anchorParagraph: lastParagraph!,
      operationGroupId: "writer_new_section_s1_test",
    });

    expect(insert.name).toBe("insert_at_anchor");
    expect(insert.id).toBe("writer_new_section_s1_test");
    expect(insert.arguments.expectedBefore).toMatchObject({
      paragraphIndex: 1,
      paragraphTextHash: stableTextHash("锚点"),
    });

    const range = targetRange("旧正文。");
    const replace = buildReplaceRangeToolCall({
      section,
      text: "## 第一节\n\n新正文。",
      targetRange: range,
      operationGroupId: "writer_revision_s1_test",
    });

    expect(replace.name).toBe("replace_paragraph_range");
    expect(replace.arguments.startParagraphIndex).toBe(2);
    expect(replace.arguments.endParagraphIndex).toBe(3);
    expect(replace.arguments.expectedBefore).toMatchObject({
      paragraphIndex: 2,
      expectedTextHash: stableTextHash(range.text),
      beforeTextHash: stableTextHash(range.text),
    });
  });
});

