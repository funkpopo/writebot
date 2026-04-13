import * as React from "react";
import {
  Button,
  Textarea,
  Spinner,
  Card,
  Text,
  mergeClasses,
} from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  Brain24Regular,
  ArrowSync24Regular,
  Delete24Regular,
  ArrowDown24Regular,
} from "@fluentui/react-icons";
import MarkdownView from "../MarkdownView";
import type { ActionType, Message } from "./types";
import { formatOriginalTextForBubble, getActionLabel } from "./types";
import { useStyles } from "./styles";
import {
  buildApplyPreviewSegments,
  createDefaultApplyPreviewSelection,
  mergeApplyPreviewSegments,
  resolveApplyPreviewSource,
  summarizeApplyPreviewSelection,
} from "./applyPreview";

interface MessageBubbleProps {
  message: Message;
  expandedThinking: Set<string>;
  editingMessageIds: Set<string>;
  appliedMessageIds: Set<string>;
  applyingMessageIds: Set<string>;
  undoableMessageIds: Set<string>;
  styles: ReturnType<typeof useStyles>;
  toggleThinking: (messageId: string) => void;
  toggleEditing: (messageId: string) => void;
  handleUpdateMessage: (messageId: string, newContent: string) => void;
  handleApply: (message: Message, overrideContent?: string) => Promise<void>;
  handleUndoApply: (messageId: string) => Promise<void>;
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({
  message,
  expandedThinking,
  editingMessageIds,
  appliedMessageIds,
  applyingMessageIds,
  undoableMessageIds,
  styles,
  toggleThinking,
  toggleEditing,
  handleUpdateMessage,
  handleApply,
  handleUndoApply,
}) => {
  const applyPreviewSource = React.useMemo(
    () => resolveApplyPreviewSource({
      content: message.content,
      applyContent: message.applyContent,
    }),
    [message.applyContent, message.content]
  );
  const previewSegments = React.useMemo(
    () => buildApplyPreviewSegments(applyPreviewSource),
    [applyPreviewSource]
  );
  const [applyPreviewOpen, setApplyPreviewOpen] = React.useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = React.useState<Set<string>>(
    () => createDefaultApplyPreviewSelection(previewSegments)
  );
  const isApplied = appliedMessageIds.has(message.id);
  const isApplying = applyingMessageIds.has(message.id);

  React.useEffect(() => {
    setSelectedSegmentIds(createDefaultApplyPreviewSelection(previewSegments));
  }, [previewSegments]);

  React.useEffect(() => {
    if (isApplied) {
      setApplyPreviewOpen(false);
    }
  }, [isApplied]);

  const selectionSummary = React.useMemo(
    () => summarizeApplyPreviewSelection(previewSegments, selectedSegmentIds),
    [previewSegments, selectedSegmentIds]
  );
  const { totalCount, selectedCount, rejectedCount } = selectionSummary;

  const selectedPreviewContent = React.useMemo(
    () => mergeApplyPreviewSegments(previewSegments, selectedSegmentIds),
    [previewSegments, selectedSegmentIds]
  );

  const keepPreviewSegment = (segmentId: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      next.add(segmentId);
      return next;
    });
  };

  const rejectPreviewSegment = (segmentId: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      next.delete(segmentId);
      return next;
    });
  };

  const keepOnlyPreviewSegment = (segmentId: string) => {
    setSelectedSegmentIds(new Set([segmentId]));
  };

  const selectAllPreviewSegments = () => {
    setSelectedSegmentIds(createDefaultApplyPreviewSelection(previewSegments));
  };

  const clearPreviewSegments = () => {
    setSelectedSegmentIds(new Set());
  };

  const toggleApplyPreview = () => {
    setApplyPreviewOpen((prev) => !prev);
  };

  const applySelectedPreviewSegments = () => {
    if (!selectedPreviewContent.trim()) return;
    void handleApply(message, selectedPreviewContent);
  };

  return (
    <div
      className={mergeClasses(
        styles.messageWrapper,
        message.type === "user"
          ? styles.userMessageWrapper
          : styles.assistantMessageWrapper
      )}
    >
      {message.type === "user" ? (
        <>
          <Text className={styles.messageLabel}>
            {getActionLabel(message.action || null, message.actionLabel)} · 原文
          </Text>
          <div className={mergeClasses(styles.messageBubble, styles.userBubble)}>
            {formatOriginalTextForBubble(message.content)}
          </div>
        </>
      ) : (
        <>
          <Text className={styles.messageLabel}>
            {getActionLabel(message.action || null, message.actionLabel)} · 结果
          </Text>
          <Card className={styles.assistantCard}>
            {message.thinking && (
              <div className={styles.thinkingSection}>
                <div
                  className={styles.thinkingHeader}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedThinking.has(message.id)}
                  onClick={() => toggleThinking(message.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleThinking(message.id);
                    }
                  }}
                >
                  <Brain24Regular className={styles.thinkingIcon} />
                  <Text className={styles.thinkingLabel}>思维过程</Text>
                  <div className={styles.thinkingHeaderTrailing}>
                    {expandedThinking.has(message.id) ? (
                      <ChevronUp24Regular />
                    ) : (
                      <ChevronDown24Regular />
                    )}
                  </div>
                </div>
                {expandedThinking.has(message.id) && (
                  <div className={styles.thinkingContent}>{message.thinking}</div>
                )}
              </div>
            )}
            <div className={styles.assistantCardContent}>
              {editingMessageIds.has(message.id) ? (
                <Textarea
                  className={styles.markdownEditor}
                  appearance="filled-lighter"
                  value={message.content}
                  onChange={(_, data) => handleUpdateMessage(message.id, data.value)}
                />
              ) : (
                <MarkdownView
                  content={message.content}
                  className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                />
              )}
            </div>
            {applyPreviewOpen && (
              <div className={styles.applyPreviewPanel}>
                <div className={styles.applyPreviewHeader}>
                  <div className={styles.applyPreviewMeta}>
                    <Text className={styles.applyPreviewTitle}>应用前预览</Text>
                    <Text className={styles.applyPreviewSubtitle}>
                      共 {totalCount} 段，已接受 {selectedCount} 段，已拒绝 {rejectedCount} 段
                    </Text>
                    <Text className={styles.applyPreviewHint}>
                      先审阅段落，再把当前接受的内容一次性写入 Word。
                    </Text>
                  </div>
                  <div className={styles.applyPreviewToolbar}>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={selectAllPreviewSegments}
                      disabled={previewSegments.length === 0 || selectedCount === previewSegments.length}
                    >
                      全选
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={clearPreviewSegments}
                      disabled={selectedCount === 0}
                    >
                      全部拒绝
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => setApplyPreviewOpen(false)}
                    >
                      收起
                    </Button>
                  </div>
                </div>

                <div className={styles.applyPreviewSegmentList}>
                  {previewSegments.map((segment, index) => {
                    const selected = selectedSegmentIds.has(segment.id);
                    return (
                      <div
                        key={segment.id}
                        className={mergeClasses(
                          styles.applyPreviewSegment,
                          !selected && styles.applyPreviewSegmentRejected
                        )}
                      >
                        <div className={styles.applyPreviewSegmentHeader}>
                          <div className={styles.applyPreviewSegmentMeta}>
                            <Text className={styles.applyPreviewSegmentIndex}>
                              第 {index + 1} 段 · {segment.kind === "table" ? "表格" : "正文"}
                            </Text>
                            <Text
                              className={mergeClasses(
                                styles.applyPreviewSegmentState,
                                selected
                                  ? styles.applyPreviewSegmentStateKept
                                  : styles.applyPreviewSegmentStateRejected
                              )}
                            >
                              {selected ? "将写入" : "已拒绝"}
                            </Text>
                          </div>
                          <div className={styles.applyPreviewSegmentActions}>
                            {selected && (
                              <Button
                                appearance="subtle"
                                size="small"
                                onClick={() => keepOnlyPreviewSegment(segment.id)}
                                disabled={selectedCount === 1}
                              >
                                只保留本段
                              </Button>
                            )}
                            <Button
                              appearance={selected ? "secondary" : "primary"}
                              size="small"
                              onClick={() => (
                                selected
                                  ? rejectPreviewSegment(segment.id)
                                  : keepPreviewSegment(segment.id)
                              )}
                            >
                              {selected ? "拒绝本段" : "恢复本段"}
                            </Button>
                          </div>
                        </div>
                        <MarkdownView
                          content={segment.rawContent}
                          className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className={styles.applyPreviewResult}>
                  <div className={styles.applyPreviewResultHeader}>
                    <Text className={styles.applyPreviewResultTitle}>最终将写入 Word 的内容</Text>
                    <Text className={styles.applyPreviewResultSubtitle}>
                      只会按当前顺序写入已接受的段落
                    </Text>
                  </div>
                  {selectedPreviewContent.trim() ? (
                    <MarkdownView
                      content={selectedPreviewContent}
                      className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                    />
                  ) : (
                    <div className={styles.applyPreviewEmpty}>
                      当前没有保留任何段落，应用按钮会保持禁用。
                    </div>
                  )}
                </div>

                <div className={styles.applyPreviewFooter}>
                  <Text className={styles.applyPreviewFooterHint}>
                    已拒绝的段落不会进入 Word，可继续调整后再应用。
                  </Text>
                  <div className={styles.applyPreviewFooterActions}>
                    <Button
                      appearance="secondary"
                      size="small"
                      onClick={() => setApplyPreviewOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      appearance="primary"
                      size="small"
                      icon={isApplying ? <Spinner size="tiny" /> : <ArrowSync24Regular />}
                      onClick={applySelectedPreviewSegments}
                      disabled={!selectedPreviewContent.trim() || isApplying || isApplied}
                    >
                      {isApplying ? "应用中..." : `应用已接受 (${selectedCount})`}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {!message.uiOnly && (
            <div className={styles.assistantActions}>
              <Button
                className={styles.actionButton}
                appearance="primary"
                size="small"
                icon={
                  isApplying
                    ? <Spinner size="tiny" />
                    : <ArrowSync24Regular />
                }
                onClick={toggleApplyPreview}
                disabled={
                  !applyPreviewSource.trim()
                  || isApplied
                  || isApplying
                  || previewSegments.length === 0
                }
              >
                {isApplying
                  ? "应用中..."
                  : isApplied
                    ? "已应用"
                    : applyPreviewOpen
                      ? "收起预览"
                      : "预览后应用"}
              </Button>
              <Button
                className={styles.actionButton}
                appearance="secondary"
                size="small"
                icon={<Delete24Regular />}
                onClick={() => handleUndoApply(message.id)}
                disabled={!undoableMessageIds.has(message.id)}
              >
                撤回
              </Button>
              <Button
                className={styles.actionButton}
                appearance="secondary"
                size="small"
                onClick={() => toggleEditing(message.id)}
              >
                {editingMessageIds.has(message.id) ? "查看结果" : "编辑结果"}
              </Button>
            </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};

const MessageBubble = React.memo(MessageBubbleInner);
MessageBubble.displayName = "MessageBubble";

export interface ChatListProps {
  messages: Message[];
  streamingContent: string;
  streamingThinking: string;
  streamingThinkingExpanded: boolean;
  setStreamingThinkingExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  expandedThinking: Set<string>;
  editingMessageIds: Set<string>;
  appliedMessageIds: Set<string>;
  applyingMessageIds: Set<string>;
  undoableMessageIds: Set<string>;
  currentAction: ActionType;
  currentActionLabel?: string;
  loading: boolean;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  handleChatScroll: React.UIEventHandler<HTMLDivElement>;
  showScrollToBottomButton: boolean;
  handleScrollToBottom: () => void;
  toggleThinking: (messageId: string) => void;
  toggleEditing: (messageId: string) => void;
  handleUpdateMessage: (messageId: string, newContent: string) => void;
  handleApply: (message: Message, overrideContent?: string) => Promise<void>;
  handleUndoApply: (messageId: string) => Promise<void>;
}

const ChatListInner: React.FC<ChatListProps> = ({
  messages,
  streamingContent,
  streamingThinking,
  streamingThinkingExpanded,
  setStreamingThinkingExpanded,
  expandedThinking,
  editingMessageIds,
  appliedMessageIds,
  applyingMessageIds,
  undoableMessageIds,
  currentAction,
  currentActionLabel,
  loading,
  chatContainerRef,
  handleChatScroll,
  showScrollToBottomButton,
  handleScrollToBottom,
  toggleThinking,
  toggleEditing,
  handleUpdateMessage,
  handleApply,
  handleUndoApply,
}) => {
  const styles = useStyles();

  if (messages.length === 0 && !streamingContent) {
    return null;
  }

  return (
    <div className={styles.chatViewport}>
      <div className={styles.chatContainer} ref={chatContainerRef} onScroll={handleChatScroll}>
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            expandedThinking={expandedThinking}
            editingMessageIds={editingMessageIds}
            appliedMessageIds={appliedMessageIds}
            applyingMessageIds={applyingMessageIds}
            undoableMessageIds={undoableMessageIds}
            styles={styles}
            toggleThinking={toggleThinking}
            toggleEditing={toggleEditing}
            handleUpdateMessage={handleUpdateMessage}
            handleApply={handleApply}
            handleUndoApply={handleUndoApply}
          />
        ))}

        {(streamingContent || streamingThinking) && (
          <div className={mergeClasses(styles.messageWrapper, styles.assistantMessageWrapper)}>
            <Text className={styles.messageLabel}>
              {getActionLabel(currentAction, currentActionLabel)} · 生成中...
            </Text>
            <Card className={styles.assistantCard}>
              {streamingThinking.trim().length > 0 && (
                <div className={styles.thinkingSection}>
                  <div
                    className={styles.thinkingHeader}
                    role="button"
                    tabIndex={0}
                    aria-expanded={streamingThinkingExpanded}
                    onClick={() => setStreamingThinkingExpanded((prev) => !prev)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setStreamingThinkingExpanded((prev) => !prev);
                      }
                    }}
                  >
                    <Brain24Regular className={styles.thinkingIcon} />
                    <Text className={styles.thinkingLabel}>思维过程</Text>
                    <div className={styles.thinkingHeaderTrailing}>
                      {!streamingThinkingExpanded && <Spinner size="tiny" />}
                      {streamingThinkingExpanded ? (
                        <ChevronUp24Regular />
                      ) : (
                        <ChevronDown24Regular />
                      )}
                    </div>
                  </div>
                  {streamingThinkingExpanded && (
                    <div className={styles.thinkingContent}>{streamingThinking}</div>
                  )}
                </div>
              )}
              <div className={styles.assistantCardContent}>
                {streamingContent ? (
                  <MarkdownView
                    content={streamingContent}
                    className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                  />
                ) : (
                  <div className={mergeClasses(styles.assistantContent, styles.loadingPlaceholderRow)}>
                    <Spinner size="tiny" />
                    <Text as="span">正在思考...</Text>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {loading && currentAction && !streamingContent && !streamingThinking && (
          <div className={mergeClasses(styles.messageWrapper, styles.assistantMessageWrapper)}>
            <Text className={styles.messageLabel}>
              {getActionLabel(currentAction, currentActionLabel)} · 生成中...
            </Text>
            <Card className={styles.assistantCard}>
              <div className={styles.assistantCardContent}>
                <div className={mergeClasses(styles.assistantContent, styles.loadingPlaceholderRow)}>
                  <Spinner size="tiny" />
                  <Text as="span">正在思考...</Text>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {showScrollToBottomButton && (
        <Button
          className={styles.scrollToBottomButton}
          appearance="primary"
          icon={<ArrowDown24Regular />}
          onClick={handleScrollToBottom}
          title="回到底部"
          aria-label="回到底部"
        />
      )}
    </div>
  );
};

export const ChatList = React.memo(ChatListInner);
ChatList.displayName = "ChatList";
