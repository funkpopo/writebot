import type { ComponentType } from "react";
import {
  Apps24Regular,
  Book24Regular,
  BrainCircuit24Regular,
  Calendar24Regular,
  Camera24Regular,
  Chat24Regular,
  ChatSparkle24Regular,
  ClipboardTask24Regular,
  Code24Regular,
  Compose24Regular,
  DataBarHorizontal24Regular,
  Document24Regular,
  DocumentText24Regular,
  Edit24Regular,
  Folder24Regular,
  Globe24Regular,
  Heart24Regular,
  Home24Regular,
  Image24Regular,
  Lightbulb24Regular,
  Mail24Regular,
  Note24Regular,
  Notebook24Regular,
  Pen24Regular,
  People24Regular,
  PersonLightbulb24Regular,
  Receipt24Regular,
  Rocket24Regular,
  ScanText24Regular,
  Search24Regular,
  Sparkle24Regular,
  Star24Regular,
  Table24Regular,
  Tag24Regular,
  Target24Regular,
  TasksApp24Regular,
  TextBulletList24Regular,
  TextEditStyle24Regular,
  TextQuote24Regular,
  SlideText24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
  TextDescription24Regular,
  TextAlignLeft24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";
import type { ActionId } from "./actionRegistry";
import type {
  AssistantModuleDefinition,
  AssistantModuleIconKey,
} from "./assistantModuleService";

export const ACTION_ICONS: Record<ActionId, ComponentType> = {
  agent: Sparkle24Regular,
  polish: TextEditStyle24Regular,
  translate: Translate24Regular,
  grammar: TextGrammarCheckmark24Regular,
  summarize: TextBulletListSquare24Regular,
  continue: TextExpand24Regular,
  generate: Wand24Regular,
};

const MODULE_ICON_BY_KEY: Record<AssistantModuleIconKey, ComponentType> = {
  agent: Sparkle24Regular,
  polish: TextEditStyle24Regular,
  translate: Translate24Regular,
  grammar: TextGrammarCheckmark24Regular,
  summarize: TextBulletListSquare24Regular,
  continue: TextExpand24Regular,
  generate: Wand24Regular,
  description: TextDescription24Regular,
  format: TextAlignLeft24Regular,
  settings: Settings24Regular,
  search: Search24Regular,
  document: Document24Regular,
  document_text: DocumentText24Regular,
  book: Book24Regular,
  notebook: Notebook24Regular,
  note: Note24Regular,
  clipboard_task: ClipboardTask24Regular,
  pen: Pen24Regular,
  edit: Edit24Regular,
  compose: Compose24Regular,
  chat: Chat24Regular,
  chat_sparkle: ChatSparkle24Regular,
  code: Code24Regular,
  data: DataBarHorizontal24Regular,
  table: Table24Regular,
  target: Target24Regular,
  lightbulb: Lightbulb24Regular,
  brain: BrainCircuit24Regular,
  apps: Apps24Regular,
  rocket: Rocket24Regular,
  globe: Globe24Regular,
  people: People24Regular,
  mail: Mail24Regular,
  calendar: Calendar24Regular,
  image: Image24Regular,
  camera: Camera24Regular,
  folder: Folder24Regular,
  home: Home24Regular,
  star: Star24Regular,
  heart: Heart24Regular,
  tag: Tag24Regular,
  receipt: Receipt24Regular,
  tasks: TasksApp24Regular,
  slide_text: SlideText24Regular,
  text_bullet: TextBulletList24Regular,
  text_quote: TextQuote24Regular,
  person_lightbulb: PersonLightbulb24Regular,
  scan: ScanText24Regular,
  custom: Wand24Regular,
};

export const ASSISTANT_MODULE_ICON_OPTIONS: Array<{
  key: AssistantModuleIconKey;
  label: string;
  Icon: ComponentType;
}> = [
  { key: "agent", label: "智能星火", Icon: Sparkle24Regular },
  { key: "polish", label: "润色编辑", Icon: TextEditStyle24Regular },
  { key: "translate", label: "翻译", Icon: Translate24Regular },
  { key: "grammar", label: "语法检查", Icon: TextGrammarCheckmark24Regular },
  { key: "summarize", label: "摘要列表", Icon: TextBulletListSquare24Regular },
  { key: "continue", label: "续写展开", Icon: TextExpand24Regular },
  { key: "generate", label: "魔法棒", Icon: Wand24Regular },
  { key: "description", label: "文本说明", Icon: TextDescription24Regular },
  { key: "format", label: "排版", Icon: TextAlignLeft24Regular },
  { key: "settings", label: "设置", Icon: Settings24Regular },
  { key: "search", label: "搜索", Icon: Search24Regular },
  { key: "document", label: "文档", Icon: Document24Regular },
  { key: "document_text", label: "文本文档", Icon: DocumentText24Regular },
  { key: "book", label: "书籍", Icon: Book24Regular },
  { key: "notebook", label: "笔记本", Icon: Notebook24Regular },
  { key: "note", label: "便签", Icon: Note24Regular },
  { key: "clipboard_task", label: "任务清单", Icon: ClipboardTask24Regular },
  { key: "pen", label: "钢笔", Icon: Pen24Regular },
  { key: "edit", label: "编辑", Icon: Edit24Regular },
  { key: "compose", label: "撰写", Icon: Compose24Regular },
  { key: "chat", label: "对话", Icon: Chat24Regular },
  { key: "chat_sparkle", label: "智能对话", Icon: ChatSparkle24Regular },
  { key: "code", label: "代码", Icon: Code24Regular },
  { key: "data", label: "数据", Icon: DataBarHorizontal24Regular },
  { key: "table", label: "表格", Icon: Table24Regular },
  { key: "target", label: "目标", Icon: Target24Regular },
  { key: "lightbulb", label: "灵感", Icon: Lightbulb24Regular },
  { key: "brain", label: "思考", Icon: BrainCircuit24Regular },
  { key: "apps", label: "应用", Icon: Apps24Regular },
  { key: "rocket", label: "推进", Icon: Rocket24Regular },
  { key: "globe", label: "全球", Icon: Globe24Regular },
  { key: "people", label: "团队", Icon: People24Regular },
  { key: "mail", label: "邮件", Icon: Mail24Regular },
  { key: "calendar", label: "日程", Icon: Calendar24Regular },
  { key: "image", label: "图片", Icon: Image24Regular },
  { key: "camera", label: "相机", Icon: Camera24Regular },
  { key: "folder", label: "文件夹", Icon: Folder24Regular },
  { key: "home", label: "主页", Icon: Home24Regular },
  { key: "star", label: "星标", Icon: Star24Regular },
  { key: "heart", label: "收藏", Icon: Heart24Regular },
  { key: "tag", label: "标签", Icon: Tag24Regular },
  { key: "receipt", label: "摘要单", Icon: Receipt24Regular },
  { key: "tasks", label: "任务应用", Icon: TasksApp24Regular },
  { key: "slide_text", label: "标题页", Icon: SlideText24Regular },
  { key: "text_bullet", label: "列表文本", Icon: TextBulletList24Regular },
  { key: "text_quote", label: "引用文本", Icon: TextQuote24Regular },
  { key: "person_lightbulb", label: "顾问", Icon: PersonLightbulb24Regular },
  { key: "scan", label: "扫描文本", Icon: ScanText24Regular },
  { key: "custom", label: "通用", Icon: Wand24Regular },
];

export function getAssistantModuleIcon(
  module?: Pick<AssistantModuleDefinition, "id" | "kind" | "simpleBehavior" | "iconKey">
): ComponentType | null {
  if (!module) return null;

  if (module.iconKey) {
    return MODULE_ICON_BY_KEY[module.iconKey];
  }

  if (module.id in ACTION_ICONS) {
    return ACTION_ICONS[module.id as ActionId];
  }

  if (module.kind === "workflow") {
    return Sparkle24Regular;
  }

  if (module.simpleBehavior === "translation") {
    return Translate24Regular;
  }

  if (module.simpleBehavior === "style") {
    return Wand24Regular;
  }

  return TextEditStyle24Regular;
}
