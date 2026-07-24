/**
 * Streaming paragraph-level flush helpers for Writer → Word.
 *
 * Design:
 * - Detect paragraph boundaries on blank lines / `。\n\n`-style breaks
 * - Batch multiple ready paragraphs into one insert (merge Word.run)
 * - Chapter-level rollback: reverse-order rollback of all flush transactions
 * - Mid-stream writes only emit a stable prefix of the intended markdown
 */

export const STREAM_FLUSH_MIN_CHARS = 80;
export const STREAM_FLUSH_MAX_PARAGRAPHS = 3;

export interface FlushableParagraphSplit {
  /** Complete paragraphs ready to consider for Word write. */
  ready: string[];
  /** Trailing incomplete paragraph still waiting for more tokens. */
  remaining: string;
}

export interface FlushBatchPlan {
  /** Markdown batches to insert (each becomes one insert_at_anchor). */
  batches: string[];
  /** Ready paragraphs held back for a larger next batch. */
  leftover: string[];
}

export function normalizeStreamNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Split buffered markdown into complete paragraphs vs trailing incomplete text.
 *
 * Boundaries:
 * - blank line (`\n\s*\n`)
 * - Chinese/full-width period followed by blank line (`。\n\n`)
 *
 * When `finalize` is true, any trailing non-empty remainder is treated as ready.
 */
export function extractFlushableParagraphs(
  buffer: string,
  finalize = false,
): FlushableParagraphSplit {
  const normalized = normalizeStreamNewlines(buffer);
  if (!normalized) {
    return { ready: [], remaining: "" };
  }

  // Prefer blank-line paragraphs; also treat 。\n\n as a hard break by
  // normalizing it into a blank-line split without dropping the period.
  const withHardBreaks = normalized.replace(/([。！？])\n{2,}/g, "$1\n\n");
  const parts = withHardBreaks.split(/\n\s*\n/);

  if (parts.length === 0) {
    return { ready: [], remaining: "" };
  }

  if (finalize) {
    const ready = parts
      .map((part) => part.replace(/^\n+|\n+$/g, ""))
      .filter((part) => part.length > 0);
    return { ready, remaining: "" };
  }

  // Keep the last segment as incomplete unless the buffer ends with a blank line,
  // which signals the last paragraph is closed.
  const endsWithBoundary = /\n\s*\n\s*$/.test(withHardBreaks);
  if (endsWithBoundary) {
    const ready = parts
      .map((part) => part.replace(/^\n+|\n+$/g, ""))
      .filter((part) => part.length > 0);
    return { ready, remaining: "" };
  }

  const incomplete = parts[parts.length - 1] ?? "";
  const completeParts = parts.slice(0, -1);
  const ready = completeParts
    .map((part) => part.replace(/^\n+|\n+$/g, ""))
    .filter((part) => part.length > 0);
  return {
    ready,
    remaining: incomplete,
  };
}

/**
 * Join paragraphs with blank lines for markdown insert.
 */
export function joinMarkdownParagraphs(paragraphs: string[]): string {
  const cleaned = paragraphs
    .map((part) => part.replace(/^\n+|\n+$/g, ""))
    .filter((part) => part.length > 0);
  if (cleaned.length === 0) return "";
  return `${cleaned.join("\n\n")}\n\n`;
}

/**
 * Batch ready paragraphs to reduce Word COM / Word.run frequency.
 * Emits a batch when minChars or maxParagraphs is reached.
 * On finalize, any leftover becomes a final batch.
 */
export function batchParagraphsForWordWrite(
  paragraphs: string[],
  options?: {
    minChars?: number;
    maxParagraphs?: number;
    finalize?: boolean;
  },
): FlushBatchPlan {
  const minChars = options?.minChars ?? STREAM_FLUSH_MIN_CHARS;
  const maxParagraphs = options?.maxParagraphs ?? STREAM_FLUSH_MAX_PARAGRAPHS;
  const finalize = options?.finalize ?? false;

  const batches: string[] = [];
  let bucket: string[] = [];
  let bucketChars = 0;

  const emitBucket = () => {
    if (bucket.length === 0) return;
    batches.push(joinMarkdownParagraphs(bucket));
    bucket = [];
    bucketChars = 0;
  };

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.replace(/^\n+|\n+$/g, "");
    if (!trimmed) continue;
    bucket.push(trimmed);
    bucketChars += trimmed.length;
    if (bucket.length >= maxParagraphs || bucketChars >= minChars) {
      emitBucket();
    }
  }

  if (finalize) {
    emitBucket();
    return { batches, leftover: [] };
  }

  return { batches, leftover: bucket };
}

/**
 * Compute the next markdown delta that is safe to append in Word.
 *
 * `written` must be a prefix of `intended` for incremental flush.
 * Returns empty string when nothing stable is ready, or when the intended
 * text drifted (caller should wait or chapter-rollback + rewrite).
 */
export function computeStableFlushDelta(params: {
  written: string;
  intended: string;
  finalize: boolean;
}): { delta: string; stable: boolean; completePrefix: string } {
  const written = normalizeStreamNewlines(params.written);
  const intended = normalizeStreamNewlines(params.intended);

  if (!intended) {
    return { delta: "", stable: true, completePrefix: written };
  }

  if (written && !intended.startsWith(written)) {
    return { delta: "", stable: false, completePrefix: written };
  }

  const unwritten = intended.slice(written.length);
  if (!unwritten) {
    return { delta: "", stable: true, completePrefix: written };
  }

  if (params.finalize) {
    return {
      delta: unwritten.endsWith("\n\n") || !unwritten.trim()
        ? unwritten
        : `${unwritten.replace(/\s+$/g, "")}\n\n`,
      stable: true,
      completePrefix: intended.endsWith("\n\n") || !intended.trim()
        ? intended
        : `${intended.replace(/\s+$/g, "")}\n\n`,
    };
  }

  const { ready, remaining } = extractFlushableParagraphs(unwritten, false);
  if (ready.length === 0) {
    return { delta: "", stable: true, completePrefix: written };
  }

  // Hold incomplete trailing text; only flush closed paragraphs.
  void remaining;
  const closed = joinMarkdownParagraphs(ready);
  return {
    delta: closed,
    stable: true,
    completePrefix: `${written}${closed}`,
  };
}

/**
 * Batch a stable delta into insert payloads, optionally holding a small tail
 * until more text arrives (unless finalize).
 *
 * `forceEmitAllReady` is used for the first Word flush so the first closed
 * paragraph appears quickly even when under minChars.
 */
export function planFlushInserts(params: {
  delta: string;
  finalize: boolean;
  minChars?: number;
  maxParagraphs?: number;
  forceEmitAllReady?: boolean;
}): { inserts: string[]; held: string } {
  const delta = normalizeStreamNewlines(params.delta);
  if (!delta.trim()) {
    return { inserts: [], held: "" };
  }

  const { ready, remaining } = extractFlushableParagraphs(delta, params.finalize);
  const { batches, leftover } = batchParagraphsForWordWrite(ready, {
    minChars: params.minChars,
    maxParagraphs: params.maxParagraphs,
    finalize: params.finalize || Boolean(params.forceEmitAllReady),
  });

  if (params.finalize || params.forceEmitAllReady) {
    const tail = leftover.length > 0 ? joinMarkdownParagraphs(leftover) : "";
    const inserts = tail ? [...batches, tail] : batches;
    return { inserts, held: "" };
  }

  const heldFromBatch = leftover.length > 0 ? joinMarkdownParagraphs(leftover) : "";
  const heldFromRemaining = remaining.trim() ? remaining : "";
  return {
    inserts: batches,
    held: `${heldFromBatch}${heldFromRemaining}`,
  };
}

export function buildStreamingFlushOperationGroupId(
  sectionId: string,
  streamToken: string,
  flushIndex: number,
): string {
  return `writer_new_section_${sectionId}_stream_${streamToken}_f${flushIndex}`;
}

export function buildStreamingSectionGroupId(sectionId: string, streamToken: string): string {
  return `writer_new_section_${sectionId}_stream_${streamToken}`;
}
