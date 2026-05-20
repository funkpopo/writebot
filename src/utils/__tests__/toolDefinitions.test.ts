import { describe, expect, it } from "bun:test";
import {
  TOOL_DEFINITIONS,
  canParallelizeReadToolBatch,
  getToolDefinition,
  requiresToolConfirmation,
} from "../toolDefinitions";

describe("toolDefinitions permission metadata", () => {
  it("assigns permission metadata to every registered tool", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.riskLevel).toBeTruthy();
      expect(typeof tool.requiresConfirmation).toBe("boolean");
      expect(tool.scope).toBeTruthy();
    }
  });

  it("allows read-only tools without confirmation", () => {
    expect(getToolDefinition("get_document_text")?.riskLevel).toBe("read");
    expect(requiresToolConfirmation("get_document_text")).toBe(false);
    expect(requiresToolConfirmation("search_document")).toBe(false);
  });

  it("requires confirmation for write and destructive tools", () => {
    expect(getToolDefinition("replace_selected_text")?.riskLevel).toBe("write");
    expect(requiresToolConfirmation("replace_selected_text")).toBe(true);
    expect(requiresToolConfirmation("insert_text")).toBe(true);
    expect(requiresToolConfirmation("replace_paragraph_range")).toBe(true);
    expect(getToolDefinition("restore_snapshot")?.riskLevel).toBe("destructive");
    expect(requiresToolConfirmation("restore_snapshot")).toBe(true);
  });

  it("marks structured edit tools as agent-auto-executable and legacy writes as manual-only", () => {
    expect(getToolDefinition("replace_selected_text")?.agentAutoExecute).toBe(false);
    expect(getToolDefinition("insert_text")?.agentAutoExecute).toBe(false);
    expect(getToolDefinition("replace_paragraph_range")?.agentAutoExecute).toBe(true);
    expect(getToolDefinition("insert_at_anchor")?.agentAutoExecute).toBe(true);
    expect(getToolDefinition("rewrite_paragraph")?.agentAutoExecute).toBe(true);
  });

  it("parallelizes only safe read tool batches", () => {
    expect(canParallelizeReadToolBatch([
      { id: "a", name: "get_document_text", arguments: {} },
      { id: "b", name: "search_document", arguments: { query: "test" } },
    ])).toBe(true);

    expect(canParallelizeReadToolBatch([
      { id: "a", name: "get_document_text", arguments: {} },
      { id: "b", name: "insert_text", arguments: { text: "test" } },
    ])).toBe(false);
  });
});
