import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import type { OutlineSection } from "../types";
import { validateWriterToolStateMachineRound } from "../writerAgent";

const section: OutlineSection = {
  id: "s1",
  title: "第一节",
  level: 1,
  description: "覆盖第一节",
  keyPoints: ["要点 A"],
  estimatedParagraphs: 2,
};

describe("writerToolStateMachine", () => {
  it("requires read-only DocumentSession tools in round 1", () => {
    expect(validateWriterToolStateMachineRound({
      round: 1,
      section,
      toolCalls: [{ id: "read_index", name: "get_document_index", arguments: {} }],
      completedWriteCount: 0,
      roundContent: "",
    })).toBe("continue");

    expect(() => validateWriterToolStateMachineRound({
      round: 1,
      section,
      toolCalls: [{ id: "write_too_early", name: "insert_at_anchor", arguments: {} }],
      completedWriteCount: 0,
      roundContent: "",
    })).toThrow(AgentHarnessError);
  });

  it("requires exactly one structured write transaction in round 2", () => {
    expect(validateWriterToolStateMachineRound({
      round: 2,
      section,
      toolCalls: [{ id: "write_once", name: "insert_at_anchor", arguments: {} }],
      completedWriteCount: 0,
      roundContent: "",
    })).toBe("continue");

    expect(() => validateWriterToolStateMachineRound({
      round: 2,
      section,
      toolCalls: [
        { id: "write_1", name: "insert_at_anchor", arguments: {} },
        { id: "write_2", name: "replace_paragraph_range", arguments: {} },
      ],
      completedWriteCount: 0,
      roundContent: "",
    })).toThrow("必须且只能提交 1 个结构化写入 transaction");

    expect(() => validateWriterToolStateMachineRound({
      round: 2,
      section,
      toolCalls: [{ id: "read_wrong_round", name: "read_document_ranges", arguments: {} }],
      completedWriteCount: 0,
      roundContent: "",
    })).toThrow("第 2 轮只允许 1 个结构化写入 transaction");
  });

  it("allows only changed-range verification in round 3 after a write", () => {
    expect(validateWriterToolStateMachineRound({
      round: 3,
      section,
      toolCalls: [{ id: "verify_range", name: "read_document_ranges", arguments: { ranges: [{ start: 2, end: 3 }] } }],
      completedWriteCount: 1,
      roundContent: "",
    })).toBe("complete");

    expect(validateWriterToolStateMachineRound({
      round: 3,
      section,
      toolCalls: [],
      completedWriteCount: 1,
      roundContent: "[[STATUS]] 完成",
    })).toBe("complete");

    expect(() => validateWriterToolStateMachineRound({
      round: 3,
      section,
      toolCalls: [{ id: "verify_without_write", name: "read_document_ranges", arguments: {} }],
      completedWriteCount: 0,
      roundContent: "",
    })).toThrow("未完成结构化写入");

    expect(() => validateWriterToolStateMachineRound({
      round: 3,
      section,
      toolCalls: [{ id: "write_again", name: "insert_at_anchor", arguments: {} }],
      completedWriteCount: 1,
      roundContent: "",
    })).toThrow("第 3 轮只允许校验 changed range");
  });

  it("rejects rounds outside the strict 3-step state machine", () => {
    expect(() => validateWriterToolStateMachineRound({
      round: 4,
      section,
      toolCalls: [],
      completedWriteCount: 1,
      roundContent: "",
    })).toThrow("超出严格 3 轮工具状态机");
  });
});

