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
    expect(source).toContain("assertSingleWriteTransaction");
    expect(source).toContain("resolveWrittenSectionFromTransaction");
    expect(source).not.toContain("readDocumentText");
    expect(source).not.toContain("TOOL_DEFINITIONS");
    expect(source).not.toContain("writeSection(");
    expect(source).not.toContain("beforeWriteText");
    expect(source).not.toContain("afterWriteText");
    expect(source).not.toContain("previousDocumentText");
    expect(source).not.toContain("currentDocumentText");
  });

  it("keeps quality-gate revision on target range reads and replace_paragraph_range", async () => {
    const source = await readSource("../qualityGate.ts");

    expect(source).toContain("readCachedWrittenSectionRange");
    expect(source).toContain("draftRevisionSection");
    expect(source).toContain("buildReplaceRangeToolCall");
    expect(source).toContain("replace_paragraph_range");
    expect(source).not.toContain("readDocumentText");
    expect(source).not.toContain("TOOL_DEFINITIONS");
    expect(source).not.toContain("writeSection(");
    expect(source).not.toContain("append_text");
    expect(source).not.toContain("append_text");
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

