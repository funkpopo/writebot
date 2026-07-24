import { describe, expect, it } from "bun:test";
import {
  batchParagraphsForWordWrite,
  buildStreamingFlushOperationGroupId,
  computeStableFlushDelta,
  extractFlushableParagraphs,
  joinMarkdownParagraphs,
  planFlushInserts,
} from "../streamingParagraphFlush";

describe("streamingParagraphFlush", () => {
  it("splits on blank lines and keeps trailing incomplete paragraph", () => {
    const split = extractFlushableParagraphs("第一段内容。\n\n第二段还在写", false);
    expect(split.ready).toEqual(["第一段内容。"]);
    expect(split.remaining).toBe("第二段还在写");
  });

  it("treats buffer ending with blank line as all ready", () => {
    const split = extractFlushableParagraphs("第一段。\n\n第二段。\n\n", false);
    expect(split.ready).toEqual(["第一段。", "第二段。"]);
    expect(split.remaining).toBe("");
  });

  it("splits on Chinese period followed by blank lines", () => {
    const split = extractFlushableParagraphs("句子一。\n\n句子二", false);
    expect(split.ready).toEqual(["句子一。"]);
    expect(split.remaining).toBe("句子二");
  });

  it("finalizes trailing remainder as ready", () => {
    const split = extractFlushableParagraphs("只有一段没有空行", true);
    expect(split.ready).toEqual(["只有一段没有空行"]);
    expect(split.remaining).toBe("");
  });

  it("batches paragraphs by minChars and maxParagraphs", () => {
    const { batches, leftover } = batchParagraphsForWordWrite(
      ["短1", "短2", "这是一段足够长的正文用来触发字符阈值合并写入"],
      { minChars: 20, maxParagraphs: 3, finalize: false },
    );
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(joinMarkdownParagraphs(["短1", "短2"]).length).toBeLessThan(40);
    // leftover may hold remainder under threshold
    expect(Array.isArray(leftover)).toBe(true);
  });

  it("emits all leftover batches on finalize", () => {
    const { batches, leftover } = batchParagraphsForWordWrite(
      ["a", "b"],
      { minChars: 1000, maxParagraphs: 10, finalize: true },
    );
    expect(leftover).toEqual([]);
    expect(batches).toEqual([joinMarkdownParagraphs(["a", "b"])]);
  });

  it("computes stable flush delta as prefix growth", () => {
    const written = "# 标题\n\n## 章\n\n第一段。\n\n";
    const intended = "# 标题\n\n## 章\n\n第一段。\n\n第二段。\n\n";
    const result = computeStableFlushDelta({ written, intended, finalize: false });
    expect(result.stable).toBe(true);
    expect(result.delta).toBe("第二段。\n\n");
  });

  it("marks unstable when intended no longer starts with written", () => {
    const result = computeStableFlushDelta({
      written: "旧前缀\n\n",
      intended: "新前缀\n\n正文\n\n",
      finalize: false,
    });
    expect(result.stable).toBe(false);
    expect(result.delta).toBe("");
  });

  it("plans inserts with early first flush even under minChars", () => {
    const { inserts, held } = planFlushInserts({
      delta: "首段内容。\n\n",
      finalize: false,
      minChars: 500,
      maxParagraphs: 3,
      forceEmitAllReady: true,
    });
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toContain("首段内容。");
    expect(held).toBe("");
  });

  it("holds small batches until threshold without forceEmit", () => {
    const { inserts, held } = planFlushInserts({
      delta: "短\n\n",
      finalize: false,
      minChars: 500,
      maxParagraphs: 3,
      forceEmitAllReady: false,
    });
    expect(inserts).toEqual([]);
    expect(held).toContain("短");
  });

  it("builds unique flush operation group ids under one section stream", () => {
    const a = buildStreamingFlushOperationGroupId("s1", "tok", 0);
    const b = buildStreamingFlushOperationGroupId("s1", "tok", 1);
    expect(a).toBe("writer_new_section_s1_stream_tok_f0");
    expect(b).toBe("writer_new_section_s1_stream_tok_f1");
    expect(a).not.toBe(b);
  });
});
