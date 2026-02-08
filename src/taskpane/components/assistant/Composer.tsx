import * as React from "react";
import {
  Button,
  Textarea,
  Spinner,
  Dropdown,
  Option,
  Tooltip,
  mergeClasses,
} from "@fluentui/react-components";
import {
  Sparkle24Regular,
  Send24Filled,
  ArrowClockwise24Regular,
  TextEditStyle24Regular,
  Translate24Regular,
  TextGrammarCheckmark24Regular,
  TextBulletListSquare24Regular,
  TextExpand24Regular,
  Wand24Regular,
  Delete24Regular,
} from "@fluentui/react-icons";
import type { ActionType, StyleType } from "./types";
import { styleLabels, getActionLabel } from "./types";
import { useStyles } from "./styles";

function getActionIcon(action: ActionType) {
  switch (action) {
    case "agent":
      return <Sparkle24Regular />;
    case "polish":
      return <TextEditStyle24Regular />;
    case "translate":
      return <Translate24Regular />;
    case "grammar":
      return <TextGrammarCheckmark24Regular />;
    case "summarize":
      return <TextBulletListSquare24Regular />;
    case "continue":
      return <TextExpand24Regular />;
    case "generate":
      return <Wand24Regular />;
    default:
      return <Sparkle24Regular />;
  }
}

export interface ComposerProps {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  selectedAction: ActionType;
  setSelectedAction: React.Dispatch<React.SetStateAction<ActionType>>;
  selectedStyle: StyleType;
  setSelectedStyle: React.Dispatch<React.SetStateAction<StyleType>>;
  loading: boolean;
  messagesLength: number;
  handleGetSelection: () => Promise<void>;
  handleClearChat: () => void;
  handleSend: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
  inputText,
  setInputText,
  selectedAction,
  setSelectedAction,
  selectedStyle,
  setSelectedStyle,
  loading,
  messagesLength,
  handleGetSelection,
  handleClearChat,
  handleSend,
}) => {
  const styles = useStyles();

  const inputPlaceholder = selectedAction === "agent"
    ? "描述你的需求，AI 会自动调用工具..."
    : "输入文本或从文档中选择内容...";

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
              />
            </Tooltip>
          )}
          {([
            "agent",
            "polish",
            "translate",
            "grammar",
            "summarize",
            "continue",
            "generate",
          ] as ActionType[]).map((action) => (
            <Tooltip key={action} content={getActionLabel(action)} relationship="label">
              <Button
                className={mergeClasses(
                  styles.toolbarButton,
                  selectedAction === action && styles.toolbarButtonActive
                )}
                appearance={selectedAction === action ? "primary" : "transparent"}
                icon={getActionIcon(action)}
                onClick={() => setSelectedAction(action)}
              />
            </Tooltip>
          ))}
        </div>
        <div className={styles.toolbarRight}>
          {(selectedAction === "continue" || selectedAction === "generate") && (
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
          <Tooltip content="发送 (Ctrl+Enter)" relationship="label">
            <Button
              className={styles.sendButton}
              appearance="primary"
              icon={loading ? <Spinner size="tiny" /> : <Send24Filled />}
              onClick={handleSend}
              disabled={loading || !inputText.trim()}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};