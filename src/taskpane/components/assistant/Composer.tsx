import * as React from "react";
import {
  Button,
  Textarea,
  Dropdown,
  Option,
  Tooltip,
  mergeClasses,
} from "@fluentui/react-components";
import {
  Send24Filled,
  Stop24Regular,
  ArrowClockwise24Regular,
  Delete24Regular,
} from "@fluentui/react-icons";
import type { ActionType, StyleType } from "./types";
import { styleLabels } from "./types";
import {
  type AssistantModuleDefinition,
  getAssistantModuleById,
} from "../../../utils/assistantModuleService";
import { getAssistantModuleIcon } from "../../../utils/actionIcons";
import { useStyles } from "./styles";
import {
  TRANSLATION_TARGET_OPTIONS,
  getTranslationTargetLabel,
  type TranslationTargetLanguage,
} from "../../../utils/translationLanguages";

const DEFAULT_INPUT_PLACEHOLDER = "输入文本或从文档中选择内容...";

function getActionIcon(module: AssistantModuleDefinition | undefined) {
  const Icon = getAssistantModuleIcon(module);
  if (!Icon) return null;
  return <Icon />;
}

export interface ComposerProps {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  selectedAction: ActionType;
  setSelectedAction: React.Dispatch<React.SetStateAction<ActionType>>;
  selectedStyle: StyleType;
  setSelectedStyle: React.Dispatch<React.SetStateAction<StyleType>>;
  selectedTranslationTarget: TranslationTargetLanguage;
  setSelectedTranslationTarget: React.Dispatch<React.SetStateAction<TranslationTargetLanguage>>;
  modules: AssistantModuleDefinition[];
  loading: boolean;
  messagesLength: number;
  handleGetSelection: () => Promise<void>;
  handleClearChat: () => void;
  handleSend: () => void;
  handleStop: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
  inputText,
  setInputText,
  selectedAction,
  setSelectedAction,
  selectedStyle,
  setSelectedStyle,
  selectedTranslationTarget,
  setSelectedTranslationTarget,
  modules,
  loading,
  messagesLength,
  handleGetSelection,
  handleClearChat,
  handleSend,
  handleStop,
}) => {
  const styles = useStyles();
  const selectedActionDef = getAssistantModuleById(selectedAction);

  const inputPlaceholder = selectedActionDef?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER;

  return (
    <div className={styles.inputContainer}>
      <Textarea
        className={styles.textarea}
        placeholder={inputPlaceholder}
        value={inputText}
        onChange={(_, data) => setInputText(data.value)}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === "Enter" && !loading && inputText.trim()) {
            e.preventDefault();
            handleSend();
          }
        }}
        appearance="filled-lighter"
      />
      <div className={styles.inputToolbar}>
        <div className={styles.toolbarLeft}>
          <Tooltip content="刷新选中文本" relationship="label">
            <Button
              className={styles.toolbarButton}
              appearance="transparent"
              icon={<ArrowClockwise24Regular />}
              onClick={handleGetSelection}
            />
          </Tooltip>
          {messagesLength > 0 && (
            <Tooltip content="清空对话" relationship="label">
              <Button
                className={styles.clearButton}
                appearance="subtle"
                icon={<Delete24Regular />}
                onClick={handleClearChat}
                disabled={loading}
              />
            </Tooltip>
          )}
          {modules.map((module) => (
            <Tooltip key={module.id} content={module.label} relationship="label">
              <Button
                className={mergeClasses(
                  styles.toolbarButton,
                  selectedAction === module.id && styles.toolbarButtonActive
                )}
                appearance={selectedAction === module.id ? "primary" : "transparent"}
                icon={getActionIcon(module)}
                onClick={() => setSelectedAction(module.id)}
              />
            </Tooltip>
          ))}
        </div>
        <div className={styles.toolbarRight}>
          {selectedActionDef?.kind === "simple" && selectedActionDef.simpleBehavior === "translation" && (
            <div className={styles.translateControls}>
              <Dropdown
                className={styles.translateDropdown}
                value={getTranslationTargetLabel(selectedTranslationTarget)}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    setSelectedTranslationTarget(data.optionValue as TranslationTargetLanguage);
                  }
                }}
                size="small"
              >
                {TRANSLATION_TARGET_OPTIONS.map((option) => (
                  <Option key={option.code} value={option.code}>
                    {option.label}
                  </Option>
                ))}
              </Dropdown>
            </div>
          )}
          {selectedActionDef?.kind === "simple" && selectedActionDef.simpleBehavior === "style" && (
            <Dropdown
              className={styles.styleDropdown}
              value={styleLabels[selectedStyle]}
              onOptionSelect={(_, data) => {
                if (data.optionValue) {
                  setSelectedStyle(data.optionValue as StyleType);
                }
              }}
              size="small"
            >
              <Option value="formal">正式</Option>
              <Option value="casual">轻松</Option>
              <Option value="professional">专业</Option>
              <Option value="creative">创意</Option>
            </Dropdown>
          )}
          <Tooltip content={loading ? "停止执行" : "发送 (Ctrl+Enter)"} relationship="label">
            <Button
              className={mergeClasses(
                styles.sendButton,
                loading && styles.sendButtonStop
              )}
              appearance="primary"
              icon={loading ? <Stop24Regular /> : <Send24Filled />}
              onClick={loading ? handleStop : handleSend}
              disabled={loading ? false : !inputText.trim() || modules.length === 0 || !selectedAction}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
