import { describe, expect, it } from "bun:test";
import { getToolDefinition } from "../toolDefinitions";
import { canAutoConfirmWhenDialogUnavailable } from "../toolConfirmationPolicy";

describe("canAutoConfirmWhenDialogUnavailable", () => {
  it("allows reversible structured writes when Office blocks confirm dialogs", () => {
    expect(canAutoConfirmWhenDialogUnavailable(getToolDefinition("insert_at_anchor"))).toBe(true);
    expect(canAutoConfirmWhenDialogUnavailable(getToolDefinition("replace_paragraph_range"))).toBe(true);
    expect(canAutoConfirmWhenDialogUnavailable(getToolDefinition("rewrite_paragraph"))).toBe(true);
  });

  it("keeps destructive and legacy writes blocked", () => {
    expect(canAutoConfirmWhenDialogUnavailable(getToolDefinition("delete_paragraph_range"))).toBe(false);
    expect(canAutoConfirmWhenDialogUnavailable(getToolDefinition("insert_text"))).toBe(false);
    expect(canAutoConfirmWhenDialogUnavailable(undefined)).toBe(false);
  });
});
