import React, { useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  Checkmark24Regular,
  Dismiss24Regular,
} from "@fluentui/react-icons";
import type { ArticleOutline } from "./types";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    maxHeight: "50vh",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flexShrink: 0,
  },
  title: {
    fontSize: "16px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  meta: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  sectionList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  sectionItem: {
    display: "flex",
    flexDirection: "column",
    padding: "8px 12px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: "13px",
    fontWeight: "500",
    color: tokens.colorNeutralForeground1,
  },
  sectionDesc: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
  keyPoints: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginTop: "6px",
    paddingLeft: "12px",
  },
  keyPoint: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  actions: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    marginTop: "4px",
    flexShrink: 0,
  },
});

interface OutlineConfirmationProps {
  outline: ArticleOutline;
  onConfirm: () => void;
  onCancel: () => void;
}

export const OutlineConfirmation: React.FC<OutlineConfirmationProps> = ({
  outline,
  onConfirm,
  onCancel,
}) => {
  const classes = useStyles();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={classes.container}>
      <div className={classes.header}>
        <Text className={classes.title}>{outline.title}</Text>
        <Text className={classes.meta}>
          {outline.style} | {outline.targetAudience} | {outline.sections.length} 个章节 | 约{" "}
          {outline.totalEstimatedParagraphs} 段
        </Text>
        {outline.theme && <Text className={classes.meta}>主题：{outline.theme}</Text>}
      </div>

      <div className={classes.sectionList}>
        {outline.sections.map((section) => {
          const isExpanded = expandedSections.has(section.id);
          return (
            <div
              key={section.id}
              className={classes.sectionItem}
              onClick={() => toggleSection(section.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") toggleSection(section.id);
              }}
            >
              <div className={classes.sectionHeader}>
                <Text className={classes.sectionTitle}>
                  {section.id}. {section.title}
                </Text>
                {isExpanded ? (
                  <ChevronUp24Regular style={{ fontSize: 14 }} />
                ) : (
                  <ChevronDown24Regular style={{ fontSize: 14 }} />
                )}
              </div>
              {section.description && (
                <Text className={classes.sectionDesc}>{section.description}</Text>
              )}
              {isExpanded && section.keyPoints.length > 0 && (
                <div className={classes.keyPoints}>
                  {section.keyPoints.map((kp, idx) => (
                    <Text key={idx} className={classes.keyPoint}>
                      - {kp}
                    </Text>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={classes.actions}>
        <Button
          appearance="secondary"
          icon={<Dismiss24Regular />}
          onClick={onCancel}
          size="small"
        >
          取消
        </Button>
        <Button
          appearance="primary"
          icon={<Checkmark24Regular />}
          onClick={onConfirm}
          size="small"
        >
          确认开始撰写
        </Button>
      </div>
    </div>
  );
};
