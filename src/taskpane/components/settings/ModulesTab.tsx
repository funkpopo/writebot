import * as React from "react";
import {
  Button,
  Input,
  Textarea,
  Card,
  Text,
  Dropdown,
  Option,
  Field,
  Switch,
  mergeClasses,
} from "@fluentui/react-components";
import { Save24Regular, Delete24Regular, Add24Regular } from "@fluentui/react-icons";
import {
  type AssistantModuleDefinition,
  type AssistantModuleIconKey,
  type AssistantSimpleBehavior,
  getAssistantModuleModeLabel,
  getDefaultAssistantModuleInputPlaceholder,
} from "../../../utils/assistantModuleService";
import { getAssistantModuleIcon } from "../../../utils/actionIcons";
import { ASSISTANT_MODULE_ICON_OPTIONS } from "../../../utils/assistantModuleIconOptions";
import { useStyles } from "./settingsStyles";
import { customModuleBehaviorOptions } from "./settingsShared";

export interface ModulesTabProps {
  modules: AssistantModuleDefinition[];
  expandedModuleId: string | null;
  setExpandedModuleId: React.Dispatch<React.SetStateAction<string | null>>;
  moduleSavingId: string | null;
  deletedModuleCount: number;
  handleAddModule: () => Promise<void>;
  handleRestoreDeletedModule: () => Promise<void>;
  handleResetModules: () => Promise<void>;
  handleDeleteModule: (moduleId: string) => Promise<void>;
  handleModuleFieldChange: (moduleId: string, field: "label" | "description" | "inputPlaceholder", value: string) => void;
  handleModuleOrderChange: (moduleId: string, rawValue: string) => void;
  handleModuleToggle: (moduleId: string, enabled: boolean) => void;
  handleModuleBehaviorChange: (moduleId: string, behavior: AssistantSimpleBehavior) => void;
  handleModuleIconChange: (moduleId: string, iconKey: AssistantModuleIconKey) => void;
  handleSaveModule: (moduleId: string) => Promise<void>;
}

export function ModulesTab({
  modules,
  expandedModuleId,
  setExpandedModuleId,
  moduleSavingId,
  deletedModuleCount,
  handleAddModule,
  handleRestoreDeletedModule,
  handleResetModules,
  handleDeleteModule,
  handleModuleFieldChange,
  handleModuleOrderChange,
  handleModuleToggle,
  handleModuleBehaviorChange,
  handleModuleIconChange,
  handleSaveModule,
}: ModulesTabProps) {
  const styles = useStyles();
  return (
          <>
            <div className={styles.actionRow}>
              <Text className={styles.activeHint}>
                已启用 {modules.filter((module) => module.enabled).length} 个模块
              </Text>
              <div className={styles.actionButtons}>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleAddModule}>
                  添加模块
                </Button>
                <Button
                  appearance="secondary"
                  onClick={handleRestoreDeletedModule}
                  disabled={deletedModuleCount === 0}
                >
                  {deletedModuleCount > 0 ? `恢复最近删除 (${deletedModuleCount})` : "恢复最近删除"}
                </Button>
                <Button appearance="secondary" icon={<Delete24Regular />} onClick={handleResetModules}>
                  恢复内置默认
                </Button>
              </div>
            </div>

            <div className={styles.profilesList}>
              {modules.map((module) => {
                const isExpanded = module.id === expandedModuleId;
                const ModuleIcon = getAssistantModuleIcon(module);
                const selectedIconOption = ASSISTANT_MODULE_ICON_OPTIONS.find(
                  (option) => option.key === module.iconKey
                );
                return (
                  <Card
                    key={module.id}
                    className={mergeClasses(styles.card, isExpanded && styles.cardExpanded)}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.cardHeaderInfo}>
                        <div className={styles.moduleTitleRow}>
                          {ModuleIcon && (
                            <span className={styles.moduleTitleIcon}>
                              <ModuleIcon />
                            </span>
                          )}
                          <Text className={styles.cardHeaderTitle}>{module.label}</Text>
                        </div>
                        <Text className={styles.cardHeaderMeta}>
                          {getAssistantModuleModeLabel(module)}
                          {" · "}
                          {module.builtIn ? "内置模块" : "自定义模块"}
                        </Text>
                      </div>
                      <div className={styles.cardHeaderStatus}>
                        <div className={styles.headerActions}>
                          <Button
                            size="small"
                            appearance="subtle"
                            className={styles.smallButton}
                            onClick={() =>
                              setExpandedModuleId((prev) => (prev === module.id ? null : module.id))
                            }
                          >
                            {isExpanded ? "收起" : "编辑"}
                          </Button>
                          <Button
                            size="small"
                            appearance="subtle"
                            className={styles.smallButton}
                            icon={<Delete24Regular />}
                            onClick={() => handleDeleteModule(module.id)}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className={styles.cardContent}>
                        <div className={styles.formGrid}>
                          <Field className={styles.fieldSpanFull} label="模块名称" required>
                            <Input
                              className={styles.input}
                              value={module.label}
                              onChange={(_, data) => handleModuleFieldChange(module.id, "label", data.value)}
                              placeholder="输入模块名称"
                            />
                          </Field>

                          <Field label="显示顺序">
                            <Input
                              className={styles.input}
                              type="number"
                              min="1"
                              value={String(module.order)}
                              onChange={(_, data) => handleModuleOrderChange(module.id, data.value)}
                            />
                              <Text className={styles.hint}>越小越靠前。</Text>
                          </Field>

                          {!module.builtIn && module.kind === "simple" && (
                            <Field label="处理方式">
                              <Dropdown
                                className={styles.modelDropdown}
                                value={
                                  customModuleBehaviorOptions.find((option) => option.value === module.simpleBehavior)?.label
                                  || customModuleBehaviorOptions[0]!.label
                                }
                                onOptionSelect={(_, data) => {
                                  if (data.optionValue) {
                                    handleModuleBehaviorChange(
                                      module.id,
                                      data.optionValue as AssistantSimpleBehavior
                                    );
                                  }
                                }}
                              >
                                {customModuleBehaviorOptions.map((option) => (
                                  <Option key={option.value} value={option.value}>
                                    {option.label}
                                  </Option>
                                ))}
                              </Dropdown>
                              <Text className={styles.hint}>文本处理 / 翻译 / 风格模板。</Text>
                            </Field>
                          )}

                          {!module.builtIn && (
                            <Field label="模块图标">
                              <div className={styles.iconPickerCurrent}>
                                {ModuleIcon && (
                                  <span className={styles.iconPickerIcon}>
                                    <ModuleIcon />
                                  </span>
                                )}
                                <span>当前图标：{selectedIconOption?.label || "未选择"}</span>
                              </div>
                              <div className={styles.iconPickerGrid}>
                                {ASSISTANT_MODULE_ICON_OPTIONS.map((option) => {
                                  const OptionIcon = option.Icon;
                                  const selected = option.key === module.iconKey;
                                  return (
                                    <button
                                      key={option.key}
                                      type="button"
                                      className={mergeClasses(
                                        styles.iconPickerButton,
                                        selected && styles.iconPickerButtonSelected
                                      )}
                                      onClick={() => handleModuleIconChange(
                                        module.id,
                                        option.key as AssistantModuleIconKey
                                      )}
                                      aria-pressed={selected}
                                      title={option.label}
                                    >
                                      <span className={styles.iconPickerIcon}>
                                        <OptionIcon />
                                      </span>
                                      <span className={styles.iconPickerLabel}>{option.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              <Text className={styles.hint}>选择一个图标即可。</Text>
                            </Field>
                          )}

                          <Field className={styles.fieldSpanFull}>
                            <Switch
                              checked={module.enabled}
                              label="显示在主页功能区域"
                              onChange={(_, data) => handleModuleToggle(module.id, data.checked)}
                            />
                            <Text className={styles.hint}>关闭后不显示在主页。</Text>
                          </Field>

                          <Field className={styles.fieldSpanFull} label="模块说明">
                            <Textarea
                              className={styles.compactTextarea}
                              value={module.description}
                              onChange={(_, data) => handleModuleFieldChange(module.id, "description", data.value)}
                              appearance="filled-lighter"
                            />
                          </Field>

                          <Field className={styles.fieldSpanFull} label="输入框占位文案">
                            <Input
                              className={styles.input}
                              value={module.inputPlaceholder || ""}
                              onChange={(_, data) => handleModuleFieldChange(module.id, "inputPlaceholder", data.value)}
                              placeholder={getDefaultAssistantModuleInputPlaceholder(module)}
                            />
                          </Field>
                        </div>

                        <div className={styles.infoCard}>
                          <Text weight="semibold" style={{ marginBottom: "8px", display: "block" }}>
                            提示词位置
                          </Text>
                          <Text className={styles.infoText}>
                            {module.kind === "workflow"
                              ? "该流程的系统提示词在“提示词”页签维护。"
                              : "保存后可在“提示词”页签继续微调。"}
                          </Text>
                        </div>

                        <div className={styles.cardActions}>
                          <Button
                            className={styles.primaryButton}
                            appearance="primary"
                            icon={<Save24Regular />}
                            onClick={() => handleSaveModule(module.id)}
                            disabled={moduleSavingId === module.id}
                          >
                            {moduleSavingId === module.id ? "保存中..." : "保存模块"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
  );
}
