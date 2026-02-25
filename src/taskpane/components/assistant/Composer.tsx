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
  ArrowSwap24Regular,
} from "@fluentui/react-icons";
import type { ActionType, StyleType } from "./types";
import { styleLabels } from "./types";
import {
  ACTION_REGISTRY,
  DEFAULT_INPUT_PLACEHOLDER,
  getActionDef,
} from "../../../utils/actionRegistry";
import { ACTION_ICONS } from "../../../utils/actionIcons";
import { useStyles } from "./styles";
import {
  TRANSLATION_SOURCE_OPTIONS,
  TRANSLATION_TARGET_OPTIONS,
  getTranslationSourceLabel,
  getTranslationTargetLabel,
  isFixedTranslationTargetLanguage,
  type TranslationSourceLanguage,
  type TranslationTargetLanguage,
} from "../../../utils/translationLanguages";

function getActionIcon(action: ActionType) {
  if (!action) return null;
  const Icon = ACTION_ICONS[action];
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
  selectedTranslationSource: TranslationSourceLanguage;
  setSelectedTranslationSource: React.Dispatch<React.SetStateAction<TranslationSourceLanguage>>;
  selectedTranslationTarget: TranslationTargetLanguage;
  setSelectedTranslationTarget: React.Dispatch<React.SetStateAction<TranslationTargetLanguage>>;
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
  selectedTranslationSource,
  setSelectedTranslationSource,
  selectedTranslationTarget,
  setSelectedTranslationTarget,
  loading,
  messagesLength,
  handleGetSelection,
  handleClearChat,
  handleSend,
  handleStop,
}) => {
  const styles = useStyles();
  const selectedActionDef = getActionDef(selectedAction);

  const inputPlaceholder = selectedActionDef?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER;

  const canSwapLanguages =
    selectedTranslationSource !== "auto"
    && isFixedTranslationTargetLanguage(selectedTranslationTarget);

  const handleSwapLanguages = () => {
    if (selectedTranslationSource === "auto") return;
    if (!isFixedTranslationTargetLanguage(selectedTranslationTarget)) return;
    const nextSource = selectedTranslationTarget;
    const nextTarget = selectedTranslationSource;
    setSelectedTranslationSource(nextSource);
    setSelectedTranslationTarget(nextTarget);
  };

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
          {ACTION_REGISTRY.map((action) => (
            <Tooltip key={action.id} content={action.label} relationship="label">
              <Button
                className={mergeClasses(
                  styles.toolbarButton,
                  selectedAction === action.id && styles.toolbarButtonActive
                )}
                appearance={selectedAction === action.id ? "primary" : "transparent"}
                icon={getActionIcon(action.id)}
                onClick={() => setSelectedAction(action.id)}
              />
            </Tooltip>
          ))}
        </div>
        <div className={styles.toolbarRight}>
          {selectedAction === "translate" && (
            <div className={styles.translateControls}>
              <Dropdown
                className={styles.translateDropdown}
                value={getTranslationSourceLabel(selectedTranslationSource)}
                onOptionSelect={(_, data) => {
                  if (data.optionValue) {
                    setSelectedTranslationSource(data.optionValue as TranslationSourceLanguage);
                  }
                }}
                size="small"
              >
                {TRANSLATION_SOURCE_OPTIONS.map((option) => (
                  <Option key={option.code} value={option.code}>
                    {option.label}
                  </Option>
                ))}
              </Dropdown>
              <Tooltip
                content={canSwapLanguages ? "交换源语言和目标语言" : "需先指定源语言和目标语言"}
                relationship="label"
              >
                <Button
                  className={styles.swapButton}
                  appearance="subtle"
                  icon={<ArrowSwap24Regular />}
                  onClick={handleSwapLanguages}
                  disabled={!canSwapLanguages}
                />
              </Tooltip>
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
          {selectedActionDef?.requiresStyle && (
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
              disabled={loading ? false : !inputText.trim()}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
