import * as React from "react";
import {
  Button,
  Textarea,
  Card,
  Text,
  Dropdown,
  Option,
  Field,
  mergeClasses,
} from "@fluentui/react-components";
import { Save24Regular, Delete24Regular } from "@fluentui/react-icons";
import {
  PromptKey,
  getPromptDefinitions,
} from "../../../utils/promptService";
import { useStyles } from "./settingsStyles";

export interface PromptsTabProps {
  promptDefinitions: ReturnType<typeof getPromptDefinitions>;
  selectedPromptDefinition: ReturnType<typeof getPromptDefinitions>[number] | undefined;
  selectedPromptKey: PromptKey;
  setSelectedPromptKey: React.Dispatch<React.SetStateAction<PromptKey>>;
  promptDraft: string;
  setPromptDraft: React.Dispatch<React.SetStateAction<string>>;
  promptSaving: boolean;
  promptIsCustomized: boolean;
  handleSavePrompt: () => Promise<void>;
  handleResetPrompt: () => Promise<void>;
  handleResetAllPrompts: () => Promise<void>;
}

export function PromptsTab({
  promptDefinitions,
  selectedPromptDefinition,
  setSelectedPromptKey,
  promptDraft,
  setPromptDraft,
  promptSaving,
  promptIsCustomized,
  handleSavePrompt,
  handleResetPrompt,
  handleResetAllPrompts,
}: PromptsTabProps) {
  const styles = useStyles();
  return (
          <Card className={mergeClasses(styles.card, styles.promptCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderInfo}>
                <Text className={styles.cardHeaderTitle}>提示词设置</Text>
                <Text className={styles.cardHeaderMeta}>查看和修改系统提示词</Text>
              </div>
              <div className={styles.headerActions}>
                <Button
                  size="small"
                  appearance="secondary"
                  className={styles.smallButton}
                  icon={<Delete24Regular />}
                  onClick={handleResetAllPrompts}
                  disabled={promptSaving}
                >
                  全部默认
                </Button>
              </div>
            </div>

            <div className={styles.promptCardContent}>
              <Field label="选择功能" required>
                <Dropdown
                  className={styles.modelDropdown}
                  value={selectedPromptDefinition?.title || ""}
                  onOptionSelect={(_, data) => {
                    if (data.optionValue) {
                      setSelectedPromptKey(data.optionValue as PromptKey);
                    }
                  }}
                >
                  {promptDefinitions.map((def) => (
                    <Option key={def.key} value={def.key}>
                      {def.title}
                    </Option>
                  ))}
                </Dropdown>
                <Text className={styles.hint}>{selectedPromptDefinition?.description}</Text>
              </Field>

              <div className={styles.promptMetaRow}>
                <Text className={styles.promptTitle}>{selectedPromptDefinition?.title || "提示词"}</Text>
                <Text className={styles.promptBadge}>{promptIsCustomized ? "已自定义" : "默认"}</Text>
              </div>

              {selectedPromptDefinition?.variables && selectedPromptDefinition.variables.length > 0 && (
                <Text className={styles.hint}>
                  变量：{selectedPromptDefinition.variables.map((v) => `{{${v.name}}}`).join("、")}
                </Text>
              )}

              <Field className={styles.promptEditorField} label="系统提示词">
                <Textarea
                  className={styles.promptTextarea}
                  value={promptDraft}
                  onChange={(_, data) => setPromptDraft(data.value)}
                  appearance="filled-lighter"
                />
              </Field>

              <div className={styles.promptActions}>
                <Button appearance="secondary" onClick={handleResetPrompt} disabled={promptSaving}>
                  恢复默认
                </Button>
                <Button
                  appearance="primary"
                  icon={<Save24Regular />}
                  onClick={handleSavePrompt}
                  disabled={promptSaving}
                >
                  {promptSaving ? "保存中..." : "保存提示词"}
                </Button>
              </div>

              <Text className={styles.hint}>保存后，下次调用对应流程时生效。</Text>
            </div>
          </Card>
  );
}
