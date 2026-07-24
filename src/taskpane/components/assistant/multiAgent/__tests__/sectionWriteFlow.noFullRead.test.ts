import { describe, expect, it } from "bun:test";

async function readSource(relativePath: string): Promise<string> {
  const response = await fetch(new URL(relativePath, import.meta.url));
  return response.text();
}

describe("sectionWriteFlow stage 5 no-full-read contract", () => {
  it("keeps article writing on draft-only model calls plus deterministic insert transactions", async () => {
    const source = await readSource("../sectionWriteFlow.ts");

    expect(source).toContain("draftSection");
    expect(source).toContain("buildInsertAtAnchorToolCall");
    expect(source).toContain("assertAnySectionWriteTransactions");
    expect(source).toContain("buildReplaceRangeToolCall");
    expect(source).toContain("reuse_range");
    expect(source).toContain("resolveWrittenSectionFromTransaction");
    expect(source).toContain("runParallelProduceOrderedCommit");
    expect(source).toContain("draftThenCommitSection");
    expect(source).toContain("commitSectionText");
    expect(source).toContain("草稿生成中");
    expect(source).toContain("已写入");
    expect(source).toContain("等待前序章节落盘");
    expect(source).toContain("正在写入");
    // 不再中途流式分段落盘
    expect(source).not.toContain("draftAndStreamWriteSection");
    expect(source).not.toContain("planFlushInserts");
    expect(source).not.toContain("readDocumentText");
    expect(source).not.toContain("TOOL_DEFINITIONS");
    expect(source).not.toContain("writeSection(");
    expect(source).not.toContain("beforeWriteText");
    expect(source).not.toContain("afterWriteText");
    expect(source).not.toContain("previousDocumentText");
    expect(source).not.toContain("currentDocumentText");
  });

  it("keeps article pipeline free of automatic review/revision modules", async () => {
    const orchestrator = await readSource("../orchestrator.ts");
    expect(orchestrator).not.toContain("runGlobalReviewAndRevision");
    expect(orchestrator).not.toContain('id: "review_cycle"');
    expect(orchestrator).toContain("resolveResumeNodeId");
    expect(orchestrator).toContain('review_cycle');
    expect(orchestrator).toContain('next: () => "finalize"');
    expect(orchestrator).toContain("runParallelDraftAndWrite");
  });

  it("keeps deterministic write guards independent of full document APIs", async () => {
    const source = await readSource("../writerWriteGuards.ts");

    expect(source).toContain("loadEditTransactions");
    expect(source).toContain("duplicate_write_detected");
    expect(source).toContain("operationGroupId");
    expect(source).not.toContain("getDocumentText");
    expect(source).not.toContain("readDocumentText");
    expect(source).not.toContain("getAllParagraphsInfo");
  });
});

