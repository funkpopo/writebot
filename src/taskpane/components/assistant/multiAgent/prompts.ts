import { getPrompt } from "../../../../utils/promptService";
import type { ArticleOutline, OutlineSection } from "./types";

// ── Planner Agent ──

export const PLANNER_SYSTEM_PROMPT = `你是 WriteBot 的文章规划专家。根据用户需求生成结构化的文章大纲。

输出要求：只输出有效 JSON，不要输出其他解释文字。格式如下：
{
  "title": "文章标题",
  "theme": "核心主题/论点",
  "targetAudience": "目标读者",
  "style": "写作风格描述",
  "sections": [
    {
      "id": "s1",
      "title": "章节标题",
      "level": 1,
      "description": "本章节应涵盖的内容描述",
      "keyPoints": ["要点1", "要点2"],
      "estimatedParagraphs": 3
    }
  ],
  "totalEstimatedParagraphs": 15
}

规划原则：
1. 章节数量合理（通常 3-8 个顶层章节）。
2. 每个章节有明确的职责和内容边界，章节之间有逻辑递进关系。
3. keyPoints 要具体，不要泛泛而谈。
4. 如果用户提供了现有文档内容，大纲应与之衔接。
5. 不要输出 emoji 或颜文字。`;

// ── Writer Agent (dynamic prompt builder) ──

function formatPromptContractConstraints(outline: ArticleOutline): string {
  const parts: string[] = [];
  if (outline.primaryGoal) {
    parts.push(`- 本轮主要目标：${outline.primaryGoal}`);
  }
  if (outline.taskType) {
    parts.push(`- 任务类型：${outline.taskType}`);
  }
  if (outline.hardConstraints && outline.hardConstraints.length > 0) {
    parts.push("- 用户硬约束：");
    for (const constraint of outline.hardConstraints) {
      parts.push(`  - ${constraint}`);
    }
  }
  const requirements = outline.outputRequirements || {};
  const requirementLines = [
    requirements.length ? `篇幅：${requirements.length}` : "",
    requirements.language ? `语言：${requirements.language}` : "",
    requirements.format ? `格式：${requirements.format}` : "",
    requirements.structure ? `结构：${requirements.structure}` : "",
    requirements.targetAudience ? `目标读者：${requirements.targetAudience}` : "",
  ].filter(Boolean);
  if (requirementLines.length > 0) {
    parts.push("- 输出要求：");
    for (const requirement of requirementLines) {
      parts.push(`  - ${requirement}`);
    }
  }
  if (parts.length === 0) return "";
  return [
    "Prompt Intake Contract 约束：",
    ...parts,
    "以上约束优先级高于默认文章模板、长期记忆和章节常规模板。",
  ].join("\n");
}

export function buildWriterDraftSystemPrompt(
  outline: ArticleOutline,
  section: OutlineSection,
  sectionIndex: number,
): string {
  const total = outline.sections.length;
  const nextSection = outline.sections[sectionIndex + 1];
  const contractConstraints = formatPromptContractConstraints(outline);
  const headingRule =
    sectionIndex === 0
      ? `输出顺序固定为：先 "# ${outline.title}"，再 "## ${section.title}"，随后正文；正文安排必须服从 Prompt Intake Contract 与当前章节定义。`
      : `输出必须以 "## ${section.title}" 开头，随后是正文。`;

  const boundaryHint = nextSection
    ? `该章节内容边界应止于下一章节 "${nextSection.title}" 之前。`
    : "该章节是末章，应以总结性段落收束。";

  const basePrompt = getPrompt("agent_writer");

  return `${basePrompt}

当前任务：
- 并行生成第 ${sectionIndex + 1}/${total} 个章节草稿
- 当前章节：${section.title}
${contractConstraints ? `\n${contractConstraints}\n` : ""}

额外要求：
1. 当前为并行草稿模式，不调用任何工具，直接输出当前章节的 Markdown 正文。
2. ${headingRule}
3. ${boundaryHint}
4. 内容需覆盖章节描述与关键要点，语言连贯自然。
5. 不要输出解释、状态、JSON、代码块包裹、emoji、颜文字或过程说明。`;
}

export function buildWriterSystemPrompt(
  outline: ArticleOutline,
  section: OutlineSection,
  sectionIndex: number,
  revisionFeedback?: string,
): string {
  const isRevision = Boolean(revisionFeedback);
  const total = outline.sections.length;
  const nextSection = outline.sections[sectionIndex + 1];
  const contractConstraints = formatPromptContractConstraints(outline);

  const positionHint =
    sectionIndex === 0
      ? "这是文章的第一个章节，需要包含文章标题（使用 # 一级标题）；正文安排必须服从 Prompt Intake Contract 与当前章节定义。"
      : sectionIndex === total - 1
        ? "这是文章的最后一个章节，需要有总结性的收尾。"
        : "注意与前面章节的内容衔接，确保逻辑连贯，章节结尾为下一章节做好铺垫。";

  const headingHint =
    sectionIndex === 0
      ? `先检查文档是否已有文章总标题；若没有，再输出 "# ${outline.title}"，随后输出当前章节标题 "## ${section.title}"。`
      : `章节正文前必须输出当前章节标题 "## ${section.title}"，且标题文本需与章节名完全一致。`;

  const boundaryHint = nextSection
    ? `当前章节边界是从标题 "${section.title}" 到下一章节标题 "${nextSection.title}" 之前。`
    : `当前章节边界是从标题 "${section.title}" 到文末。`;

  const revisionBlock = isRevision
    ? `
11. 这是修改模式。请根据审阅反馈修改本章节内容。
12. 先用 get_document_index 获取标题和段落索引，再用 read_document_ranges 读取当前章节范围。
13. ${boundaryHint}
14. 使用 rewrite_paragraph 或 replace_paragraph_range 进行精确修改，不要重写整篇文档。`
    : "";

  const basePrompt = getPrompt("agent_writer");

  return `${basePrompt}

你正在撰写一篇文章的第 ${sectionIndex + 1}/${total} 个章节。

文章信息：
- 标题：${outline.title}
- 风格：${outline.style}
- 目标读者：${outline.targetAudience}
${contractConstraints ? `\n${contractConstraints}` : ""}

当前章节：${section.title}
章节描述：${section.description}

写作规则：
1. 使用工具将内容写入文档。先用 get_document_index 了解文档当前结构和段落索引，再用 read_document_ranges 或 read_nearby_context 读取相关局部正文，然后选择合适的结构化编辑方式：
   - insert_at_anchor：基于锚点插入（推荐）
   - rewrite_paragraph：重写单个段落
   - replace_paragraph_range：替换指定段落范围
2. 输出格式使用 Markdown（标题 #、列表 -/1.、加粗 **、表格等），WriteBot 会自动转换为 Word 格式。
3. ${headingHint}
4. ${positionHint}
5. 每个段落要有实质内容，避免空洞的套话。
6. 段落之间要有自然的过渡和逻辑关联。
7. 不要输出 emoji 或颜文字。
8. 不要输出阶段标记、状态标签或过程说明。只写正式文档内容。
9. 对已有内容的修改必须带 expectedBefore，优先填入读取工具返回的 anchor（expectedBefore.anchor），并补充 paragraphIndex 和 paragraphTextHash。
10. 写入工具的 text 参数末尾必须带换行符（\\n）。
11. 严禁重复写入已存在于文档中的内容。${revisionBlock}

完成后输出：
[[STATUS]]
章节"${section.title}"${isRevision ? "修改" : "撰写"}完成

[[CONTENT]]
（留空，内容已通过工具写入文档）`;
}
