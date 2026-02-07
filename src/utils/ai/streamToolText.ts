/**
 * Streaming tool-text extraction from incremental JSON arguments.
 *
 * Some agent tool calls contain large text payloads inside JSON arguments
 * (e.g. insert_text / append_text). When streaming tool calls, we want to
 * surface the incremental "text" value to the UI without waiting for the
 * full tool call to finish.
 */

export const TOOL_TEXT_STREAM_NAMES = new Set(["insert_text", "append_text", "replace_selected_text"]);
export const TEXT_ARG_START_RE = /\"text\"\s*:\s*\"/;

export type ToolTextStreamState = {
  parsePos: number;
  pendingEscape: boolean;
  pendingUnicode: string | null; // collected hex digits (0-4) after a \u escape
  done: boolean;
};

export function streamToolTextFromArgs(
  rawArgs: string,
  toolName: string | undefined,
  state: ToolTextStreamState | undefined,
  onDelta: (delta: string) => void
): ToolTextStreamState | undefined {
  if (!toolName || !TOOL_TEXT_STREAM_NAMES.has(toolName)) return state;

  let next = state;
  if (!next) {
    const match = TEXT_ARG_START_RE.exec(rawArgs);
    if (!match || match.index === undefined) {
      return state;
    }

    const start = match.index + match[0].length;
    next = {
      parsePos: start,
      pendingEscape: false,
      pendingUnicode: null,
      done: false,
    };
  }

  if (next.done) return next;

  let deltaOut = "";

  while (next.parsePos < rawArgs.length) {
    // Continue an unfinished \uXXXX sequence.
    if (next.pendingUnicode !== null) {
      while (next.parsePos < rawArgs.length && next.pendingUnicode.length < 4) {
        const h = rawArgs[next.parsePos];
        if (!/[0-9a-fA-F]/.test(h)) {
          // Invalid escape: best-effort drop the escape rather than polluting output.
          next.pendingUnicode = null;
          break;
        }
        next.pendingUnicode += h;
        next.parsePos += 1;
      }

      if (next.pendingUnicode !== null && next.pendingUnicode.length < 4) {
        // Need more bytes.
        break;
      }

      if (next.pendingUnicode !== null && next.pendingUnicode.length === 4) {
        const code = parseInt(next.pendingUnicode, 16);
        deltaOut += String.fromCharCode(code);
        next.pendingUnicode = null;
      }

      continue;
    }

    // Continue an unfinished escape (we already consumed the backslash).
    if (next.pendingEscape) {
      if (next.parsePos >= rawArgs.length) break;
      const esc = rawArgs[next.parsePos];
      next.parsePos += 1;
      next.pendingEscape = false;

      switch (esc) {
        case "\"":
          deltaOut += "\"";
          break;
        case "\\":
          deltaOut += "\\";
          break;
        case "/":
          deltaOut += "/";
          break;
        case "n":
          deltaOut += "\n";
          break;
        case "r":
          deltaOut += "\r";
          break;
        case "t":
          deltaOut += "\t";
          break;
        case "b":
          deltaOut += "\b";
          break;
        case "f":
          deltaOut += "\f";
          break;
        case "u":
          next.pendingUnicode = "";
          break;
        default:
          // Unknown escape: emit the raw char (best-effort).
          deltaOut += esc;
          break;
      }
      continue;
    }

    const ch = rawArgs[next.parsePos];
    next.parsePos += 1;

    // End of the "text" JSON string value.
    if (ch === "\"") {
      next.done = true;
      break;
    }

    if (ch === "\\") {
      next.pendingEscape = true;
      continue;
    }

    deltaOut += ch;
  }

  if (deltaOut) onDelta(deltaOut);
  return next;
}
