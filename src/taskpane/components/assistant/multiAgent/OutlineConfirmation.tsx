import React, { useMemo, useState } from "react";
import { Button, Field, Input, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowDown24Regular,
  ArrowUp24Regular,
  Checkmark24Regular,
  ChevronDown24Regular,
  ChevronUp24Regular,
  Delete24Regular,
  Dismiss24Regular,
} from "@fluentui/react-icons";
import type { ArticleOutline, OutlineSection } from "./types";
import { cloneOutline, validateAndNormalizeOutline } from "./outlineEditing";
import { SPACING } from "../../../ui/layoutConstants";
import { NATIVE_RADIUS } from "../../../ui/nativeTokens";

const useStyles = makeStyles({
  container: {
    display: "flex", flexDirection: "column", gap: SPACING.md, padding: "10px 12px",
    backgroundColor: tokens.colorNeutralBackground2, borderRadius: NATIVE_RADIUS.large,
    border: `1px solid ${tokens.colorNeutralStroke1}`, maxHeight: "min(58vh, 560px)", overflow: "hidden",
  },
  header: { display: "flex", flexDirection: "column", gap: SPACING.xs, flexShrink: 0 },
  headingRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: SPACING.sm },
  title: { fontSize: "14px", fontWeight: "600", color: tokens.colorNeutralForeground1 },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  outlineFields: { display: "flex", flexDirection: "column", gap: SPACING.sm },
  field: {
    minWidth: 0,
    "& label": { fontSize: "11px" },
    "& input, & textarea": { fontSize: "12px" },
  },
  sectionList: {
    display: "flex", flexDirection: "column", gap: SPACING.sm, overflowY: "auto",
    flex: 1, minHeight: 0, paddingRight: "2px",
  },
  sectionItem: {
    display: "flex", flexDirection: "column", gap: SPACING.xs, padding: "8px",
    backgroundColor: tokens.colorNeutralBackground1, borderRadius: NATIVE_RADIUS.medium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionHeader: { display: "flex", alignItems: "center", gap: SPACING.xs },
  sectionNumber: {
    flex: "0 0 auto", minWidth: "18px", fontSize: "11px", fontWeight: "600",
    color: tokens.colorNeutralForeground3,
  },
  sectionTitleInput: { flex: 1, minWidth: 0 },
  sectionTools: { display: "flex", alignItems: "center", gap: "2px", flex: "0 0 auto" },
  iconButton: { minWidth: "26px", width: "26px", height: "26px", padding: 0 },
  sectionDetails: {
    display: "flex", flexDirection: "column", gap: SPACING.sm, paddingTop: "4px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: "11px", lineHeight: "1.4" },
  addButton: { alignSelf: "flex-start" },
  actions: {
    display: "flex", gap: SPACING.md, justifyContent: "flex-end", flexShrink: 0,
    "& > button": { flex: 1 },
  },
});

interface OutlineConfirmationProps {
  outline: ArticleOutline;
  onConfirm: (outline: ArticleOutline) => void;
  onCancel: () => void;
}

function createSection(index: number): OutlineSection {
  return {
    id: `s${index + 1}_${Date.now().toString(36)}`,
    title: `新章节 ${index + 1}`,
    level: 1,
    description: "",
    keyPoints: [],
    estimatedParagraphs: 2,
  };
}

export const OutlineConfirmation: React.FC<OutlineConfirmationProps> = ({ outline, onConfirm, onCancel }) => {
  const classes = useStyles();
  const [draft, setDraft] = useState<ArticleOutline>(() => cloneOutline(outline));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(outline.sections.map((section) => section.id)),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const estimatedParagraphs = useMemo(
    () => draft.sections.reduce(
      (total, section) => total + Math.max(1, Math.round(section.estimatedParagraphs || 1)), 0,
    ),
    [draft.sections],
  );

  const updateRoot = (patch: Partial<ArticleOutline>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setValidationError(null);
  };

  const updateSection = (index: number, patch: Partial<OutlineSection>) => {
    setDraft((previous) => ({
      ...previous,
      sections: previous.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, ...patch } : section
      ),
    }));
    setValidationError(null);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.sections.length) return;
    setDraft((previous) => {
      const sections = [...previous.sections];
      [sections[index], sections[target]] = [sections[target]!, sections[index]!];
      return { ...previous, sections };
    });
  };

  const removeSection = (index: number) => {
    setDraft((previous) => ({
      ...previous,
      sections: previous.sections.filter((_, sectionIndex) => sectionIndex !== index),
    }));
    setValidationError(null);
  };

  const addSection = () => {
    const section = createSection(draft.sections.length);
    setDraft((previous) => ({ ...previous, sections: [...previous.sections, section] }));
    setExpandedSections((previous) => new Set(previous).add(section.id));
    setValidationError(null);
  };

  const toggleSection = (id: string) => {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirm = () => {
    const result = validateAndNormalizeOutline(draft);
    if (!result.outline) {
      setValidationError(result.error || "大纲内容不完整，请检查后重试。");
      return;
    }
    onConfirm(result.outline);
  };

  return (
    <div className={classes.container} aria-label="编辑并确认文章大纲">
      <div className={classes.header}>
        <div className={classes.headingRow}>
          <Text className={classes.title}>编辑文章大纲</Text>
          <Text className={classes.meta}>{draft.sections.length} 个章节 · 约 {estimatedParagraphs} 段</Text>
        </div>
        <Text className={classes.meta}>可修改标题、主题、章节和要点；写作设置保持不变。</Text>
        <div className={classes.outlineFields}>
          <Field label="文章标题" required className={classes.field}>
            <Input value={draft.title} onChange={(_, data) => updateRoot({ title: data.value })} aria-label="文章标题" />
          </Field>
          <Field label="主题" className={classes.field}>
            <Textarea value={draft.theme} onChange={(_, data) => updateRoot({ theme: data.value })} resize="vertical" aria-label="主题" />
          </Field>
        </div>
      </div>

      <div className={classes.sectionList}>
        {draft.sections.map((section, index) => {
          const expanded = expandedSections.has(section.id);
          return (
            <div key={section.id} className={classes.sectionItem}>
              <div className={classes.sectionHeader}>
                <Text className={classes.sectionNumber}>{index + 1}.</Text>
                <Input
                  className={classes.sectionTitleInput}
                  value={section.title}
                  onChange={(_, data) => updateSection(index, { title: data.value })}
                  aria-label={`第 ${index + 1} 章标题`}
                />
                <div className={classes.sectionTools}>
                  <Button className={classes.iconButton} appearance="subtle" icon={<ArrowUp24Regular />}
                    disabled={index === 0} onClick={() => moveSection(index, -1)} title="上移章节" aria-label={`上移第 ${index + 1} 章`} />
                  <Button className={classes.iconButton} appearance="subtle" icon={<ArrowDown24Regular />}
                    disabled={index === draft.sections.length - 1} onClick={() => moveSection(index, 1)} title="下移章节" aria-label={`下移第 ${index + 1} 章`} />
                  <Button className={classes.iconButton} appearance="subtle" icon={<Delete24Regular />}
                    onClick={() => removeSection(index)} title="删除章节" aria-label={`删除第 ${index + 1} 章`} />
                  <Button className={classes.iconButton} appearance="subtle"
                    icon={expanded ? <ChevronUp24Regular /> : <ChevronDown24Regular />}
                    onClick={() => toggleSection(section.id)} title={expanded ? "收起章节详情" : "展开章节详情"}
                    aria-label={`${expanded ? "收起" : "展开"}第 ${index + 1} 章详情`} aria-expanded={expanded} />
                </div>
              </div>

              {expanded && (
                <div className={classes.sectionDetails}>
                  <Field label="章节说明" className={classes.field}>
                    <Textarea value={section.description}
                      onChange={(_, data) => updateSection(index, { description: data.value })}
                      resize="vertical" aria-label={`第 ${index + 1} 章说明`} />
                  </Field>
                  <Field label="写作要点（每行一条）" className={classes.field}>
                    <Textarea value={section.keyPoints.join("\n")}
                      onChange={(_, data) => updateSection(index, { keyPoints: data.value.split(/\r?\n/u) })}
                      resize="vertical" aria-label={`第 ${index + 1} 章写作要点`} />
                  </Field>
                </div>
              )}
            </div>
          );
        })}

        <Button className={classes.addButton} appearance="subtle" icon={<Add24Regular />}
          onClick={addSection} size="small">添加章节</Button>
      </div>

      {validationError && <Text role="alert" className={classes.error}>{validationError}</Text>}

      <div className={classes.actions}>
        <Button appearance="secondary" icon={<Dismiss24Regular />} onClick={onCancel} size="small">取消</Button>
        <Button appearance="primary" icon={<Checkmark24Regular />} onClick={confirm} size="small">按此大纲开始撰写</Button>
      </div>
    </div>
  );
};
