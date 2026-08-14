import type { ToolDefinition } from "../types/tools";

/**
 * Office WebView can disable synchronous window.confirm. In that environment,
 * only deterministic, explicitly auto-executable and undoable non-destructive
 * tools may continue. Destructive and legacy tools remain blocked.
 */
export function canAutoConfirmWhenDialogUnavailable(
  tool: ToolDefinition | undefined,
): boolean {
  return Boolean(
    tool?.agentAutoExecute
    && tool.supportsUndo
    && tool.riskLevel !== "destructive",
  );
}
