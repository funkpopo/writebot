import DiffMatchPatch from "diff-match-patch";

export type TextDiffKind = "equal" | "insert" | "delete";

export interface TextDiffSegment {
  kind: TextDiffKind;
  text: string;
}

/** Build a presentation-safe semantic diff without emitting raw HTML. */
export function buildTextDiff(before: string, after: string): TextDiffSegment[] {
  const engine = new DiffMatchPatch();
  engine.Diff_Timeout = 0.5;
  const diffs = engine.diff_main(before, after, true);
  engine.diff_cleanupSemantic(diffs);

  return diffs
    .filter(([, text]) => text.length > 0)
    .map(([operation, text]) => ({
      kind: operation === DiffMatchPatch.DIFF_INSERT
        ? "insert"
        : operation === DiffMatchPatch.DIFF_DELETE
          ? "delete"
          : "equal",
      text,
    }));
}
