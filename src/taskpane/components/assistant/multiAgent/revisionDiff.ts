const SOURCE_ANCHOR_RE =
  /(?:\[\s*来源锚点\s*[:：][^\]\n]+?\]|\(\s*来源锚点\s*[:：][^) \n]+?\)|（\s*来源锚点\s*[:：][^）\n]+?）|【\s*来源锚点\s*[:：][^】\n]+?】)/gu;

export function stripSourceAnchorMarkers(text: string): string {
  if (!text) return "";
  return text.replace(SOURCE_ANCHOR_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function toParagraphsForComparison(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.replace(/^#{1,6}\s+/, "").trim())
    .filter((item) => item.length > 0);
}

interface ParagraphDiffEntry {
  before: string;
  after: string;
  kind: "replace" | "insert" | "delete";
}

export function computeParagraphDiff(
  beforeParagraphs: string[],
  afterParagraphs: string[],
): ParagraphDiffEntry[] {
  const entries: ParagraphDiffEntry[] = [];
  let i = 0;
  let j = 0;

  while (i < beforeParagraphs.length && j < afterParagraphs.length) {
    const before = beforeParagraphs[i];
    const after = afterParagraphs[j];

    if (before === after) {
      i += 1;
      j += 1;
      continue;
    }

    const nextBefore = i + 1 < beforeParagraphs.length ? beforeParagraphs[i + 1] : null;
    const nextAfter = j + 1 < afterParagraphs.length ? afterParagraphs[j + 1] : null;

    if (nextBefore && nextBefore === after) {
      entries.push({ before, after: "（该段已删除）", kind: "delete" });
      i += 1;
      continue;
    }

    if (nextAfter && before === nextAfter) {
      entries.push({ before: "（新增段落）", after, kind: "insert" });
      j += 1;
      continue;
    }

    entries.push({ before, after, kind: "replace" });
    i += 1;
    j += 1;
  }

  while (i < beforeParagraphs.length) {
    entries.push({ before: beforeParagraphs[i], after: "（该段已删除）", kind: "delete" });
    i += 1;
  }

  while (j < afterParagraphs.length) {
    entries.push({ before: "（新增段落）", after: afterParagraphs[j], kind: "insert" });
    j += 1;
  }

  return entries;
}

function toParagraphPreview(text: string, limit = 90): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "（空）";
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

export function buildRevisionParagraphMessage(
  sectionTitle: string,
  beforeText: string,
  afterText: string,
): string {
  const beforeParagraphs = toParagraphsForComparison(beforeText);
  const afterParagraphs = toParagraphsForComparison(afterText);
  const diffEntries = computeParagraphDiff(beforeParagraphs, afterParagraphs);
  const maxEntries = 4;
  const list = diffEntries.slice(0, maxEntries);

  const lines: string[] = [`### ${sectionTitle}（修订 diff）`];
  if (list.length === 0) {
    lines.push("- 未提取到段落差异（可能为格式调整）。");
    return lines.join("\n");
  }

  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    const changeLabel = item.kind === "insert" ? "新增" : item.kind === "delete" ? "删除" : "改写";
    lines.push(`#### 段落 ${index + 1}（${changeLabel}）`);
    lines.push(`原文：${toParagraphPreview(item.before)}`);
    lines.push(`新文：${toParagraphPreview(item.after)}`);
  }

  if (diffEntries.length > list.length) {
    lines.push(`- 其余 ${diffEntries.length - list.length} 处变更已省略`);
  }
  return lines.join("\n");
}
