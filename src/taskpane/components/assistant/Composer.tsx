import * as React from "react";
import {
  Button,
  Textarea,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Tooltip,
  mergeClasses,
} from "@fluentui/react-components";
import {
  Send24Filled,
  Stop24Regular,
  ArrowClockwise24Regular,
  CheckmarkCircle24Regular,
  Circle24Regular,
  Delete24Regular,
  Warning24Regular,
} from "@fluentui/react-icons";
import type { ActionType, AgentPermissionMode, StyleType } from "./types";
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
  agentPermissionMode: AgentPermissionMode;
  modules: AssistantModuleDefinition[];
  loading: boolean;
  messagesLength: number;
  handleGetSelection: () => Promise<void>;
  handleClearChat: () => void;
  handleSelectAgentPermissionMode: (mode: AgentPermissionMode) => void;
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
  agentPermissionMode,
  modules,
  loading,
  messagesLength,
  handleGetSelection,
  handleClearChat,
  handleSelectAgentPermissionMode,
  handleSend,
  handleStop,
}) => {
  const styles = useStyles();
  const selectedActionDef = getAssistantModuleById(selectedAction);

  const inputPlaceholder = selectedActionDef?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER;
  const permissionOptions: Array<{
    mode: AgentPermissionMode;
    label: string;
    icon: React.ReactElement;
    tooltip: string;
  }> = [
    {
      mode: "default",
      label: "默认权限",
      icon: <Circle24Regular />,
      tooltip: "写入和高风险工具会请求确认",
    },
    {
      mode: "auto_review",
      label: "自动审查",
      icon: <CheckmarkCircle24Regular />,
      tooltip: "自动批准建议/写入工具，高风险工具仍会请求确认",
    },
    {
      mode: "full_access",
      label: "完全访问权限",
      icon: <Warning24Regular />,
      tooltip: "自动批准所有工具调用",
    },
  ];
  const selectedPermission = permissionOptions.find((option) => option.mode === agentPermissionMode)
    || permissionOptions[0];

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
          <Menu positioning="above-start">
            <MenuTrigger disableButtonEnhancement>
              <MenuButton
                className={mergeClasses(
                  styles.permissionMenuButton,
                  agentPermissionMode === "auto_review" && styles.permissionMenuButtonAuto,
                  agentPermissionMode === "full_access" && styles.permissionMenuButtonFull
                )}
                appearance="subtle"
                icon={selectedPermission.icon}
                disabled={loading}
              >
                {selectedPermission.label}
              </MenuButton>
            </MenuTrigger>
            <MenuPopover className={styles.permissionMenuPopover}>
              <MenuList>
                {permissionOptions.map((option) => (
                  <MenuItem
                    key={option.mode}
                    icon={option.icon}
                    secondaryContent={agentPermissionMode === option.mode ? "✓" : undefined}
                    onClick={() => handleSelectAgentPermissionMode(option.mode)}
                  >
                    <Tooltip content={option.tooltip} relationship="description">
                      <span>{option.label}</span>
                    </Tooltip>
                  </MenuItem>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Dropdown
            className={styles.moduleDropdown}
            value={selectedActionDef?.label ?? "选择功能"}
            onOptionSelect={(_, data) => {
              if (data.optionValue) {
                setSelectedAction(data.optionValue as ActionType);
              }
            }}
            size="small"
          >
            {modules.map((module) => {
              const Icon = getAssistantModuleIcon(module);
              return (
                <Option key={module.id} value={module.id} text={module.label}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {Icon && <Icon />}
                    <span>{module.label}</span>
                  </div>
                </Option>
              );
            })}
          </Dropdown>
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
              aria-label={loading ? "停止执行" : "发送"}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
