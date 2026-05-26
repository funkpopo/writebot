import { getDocumentText } from "../../../../utils/wordApi";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";

export async function readDocumentText(
  harness: AgentHarnessRuntime,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const event = harness.recordEvent({
    kind: "document_read_started",
    message: "Reading Word document text",
    metadata,
  });

  try {
    const text = await getDocumentText();
    harness.completeEvent(event, {
      kind: "document_read_completed",
      metadata: {
        ...(metadata || {}),
        chars: text.length,
      },
    });
    return text;
  } catch (error) {
    harness.completeEvent(event, {
      kind: "document_read_failed",
      metadata: {
        ...(metadata || {}),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw new AgentHarnessError(
      "document_read_failed",
      `读取 Word 文档失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error, details: metadata },
    );
  }
}
