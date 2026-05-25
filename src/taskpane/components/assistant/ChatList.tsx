import * as React from "react";
import { Suspense, lazy } from "react";
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
import type { ActionType, Message } from "./types";
import { formatOriginalTextForBubble, getActionLabel } from "./types";
import { useStyles } from "./styles";
import { useDelayedBusyState } from "../../hooks/useDelayedBusyState";
import type { WordDiffPreviewState } from "./useAssistantState";
import {
  buildApplyPreviewSegments,
  createDefaultApplyPreviewSelection,
  mergeApplyPreviewSegments,
  resolveApplyPreviewSource,
  summarizeApplyPreviewSelection,
} from "./applyPreview";

const MarkdownView = lazy(() => import("../MarkdownView"));

const MarkdownFallback: React.FC<{ className?: string; content: string }> = ({ className, content }) => (
  <div className={className}>{content}</div>
);

const LazyMarkdownView: React.FC<{ className?: string; content: string }> = ({ className, content }) => (
  <Suspense fallback={<MarkdownFallback className={className} content={content} />}>
    <MarkdownView content={content} className={className} />
  </Suspense>
);

interface MessageBubbleProps {
  message: Message;
  expandedThinking: Set<string>;
  editingMessageIds: Set<string>;
  appliedMessageIds: Set<string>;
  applyingMessageIds: Set<string>;
  undoableMessageIds: Set<string>;
  appliedTransactionCounts: Map<string, number>;
  styles: ReturnType<typeof useStyles>;
  toggleThinking: (messageId: string) => void;
  toggleEditing: (messageId: string) => void;
  handleUpdateMessage: (messageId: string, newContent: string) => void;
  prepareApplyPreview: (content: string) => Promise<WordDiffPreviewState | null>;
  handleApply: (message: Message, overrideContent?: string, preparedTransactionId?: string) => Promise<void>;
  handleUndoApply: (messageId: string) => Promise<void>;
}

const MessageBubbleInner: React.FC<MessageBubbleProps> = ({
  message,
  expandedThinking,
  editingMessageIds,
  appliedMessageIds,
  applyingMessageIds,
  undoableMessageIds,
  appliedTransactionCounts,
  styles,
  toggleThinking,
  toggleEditing,
  handleUpdateMessage,
  prepareApplyPreview,
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
  const appliedTransactionCount = appliedTransactionCounts.get(message.id) || 0;
  const isApplying = applyingMessageIds.has(message.id);
  const [wordDiffPreview, setWordDiffPreview] = React.useState<WordDiffPreviewState | null>(null);
  const [preparingWordDiff, setPreparingWordDiff] = React.useState(false);

  React.useEffect(() => {
    setSelectedSegmentIds(createDefaultApplyPreviewSelection(previewSegments));
    setWordDiffPreview(null);
  }, [previewSegments]);

  React.useEffect(() => {
    if (isApplied) {
      setApplyPreviewOpen(false);
    }
  }, [isApplied]);
  const showApplyingFeedback = useDelayedBusyState(isApplying);

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
    if (!selectedPreviewContent.trim() || !wordDiffPreview) return;
    void handleApply(message, selectedPreviewContent, wordDiffPreview.transactionId);
  };

  const createWordDiffPreview = async () => {
    if (!selectedPreviewContent.trim()) return;
    setPreparingWordDiff(true);
    try {
      const preview = await prepareApplyPreview(selectedPreviewContent);
      setWordDiffPreview(preview);
    } finally {
      setPreparingWordDiff(false);
    }
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
                <LazyMarkdownView
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
                        <LazyMarkdownView
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
                    <LazyMarkdownView
                      content={selectedPreviewContent}
                      className={mergeClasses(styles.assistantContent, styles.markdownContent)}
                    />
                  ) : (
                    <div className={styles.applyPreviewEmpty}>
                      当前没有保留任何段落，应用按钮会保持禁用。
                    </div>
                  )}
                </div>

                {wordDiffPreview && (
                  <div className={styles.applyPreviewResult}>
                    <div className={styles.applyPreviewResultHeader}>
                      <Text className={styles.applyPreviewResultTitle}>Word 级变更预览</Text>
                      <Text className={styles.applyPreviewResultSubtitle}>
                        {wordDiffPreview.summary || wordDiffPreview.operationTitle}
                      </Text>
                    </div>
                    <div className={styles.applyPreviewSegment}>
                      <div className={styles.applyPreviewSegmentHeader}>
                        <div className={styles.applyPreviewSegmentMeta}>
                          <Text className={styles.applyPreviewSegmentIndex}>写入前</Text>
                        </div>
                      </div>
                      <Text>{wordDiffPreview.beforeText || "（空）"}</Text>
                    </div>
                    <div className={styles.applyPreviewSegment}>
                      <div className={styles.applyPreviewSegmentHeader}>
                        <div className={styles.applyPreviewSegmentMeta}>
                          <Text className={styles.applyPreviewSegmentIndex}>写入后</Text>
                        </div>
                      </div>
                      <Text>{wordDiffPreview.afterText || "（空）"}</Text>
                    </div>
                  </div>
                )}

                <div className={styles.applyPreviewFooter}>
                  <Text className={styles.applyPreviewFooterHint}>
                    已拒绝的段落不会进入 Word。生成 Word 级变更预览后，确认提交才会真正写入。
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
                      icon={preparingWordDiff ? <Spinner size="tiny" /> : <ArrowSync24Regular />}
                      onClick={wordDiffPreview ? applySelectedPreviewSegments : () => { void createWordDiffPreview(); }}
                      disabled={!selectedPreviewContent.trim() || isApplying || isApplied}
                    >
                      {showApplyingFeedback
                        ? "应用中..."
                        : preparingWordDiff
                          ? "生成预览..."
                          : wordDiffPreview
                            ? "确认写入"
                            : `生成 Word 预览 (${selectedCount})`}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {!message.uiOnly && (
            <div className={styles.assistantActions}>
              {appliedTransactionCount > 0 && (
                <Text className={styles.changeTimelineSmallText}>
                  已应用 {appliedTransactionCount} 项变更
                </Text>
              )}
              <Button
                className={styles.actionButton}
                appearance="primary"
                size="small"
                icon={
                  showApplyingFeedback
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
                {showApplyingFeedback
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
  appliedTransactionCounts: Map<string, number>;
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
  prepareApplyPreview: (content: string) => Promise<WordDiffPreviewState | null>;
  handleApply: (message: Message, overrideContent?: string, preparedTransactionId?: string) => Promise<void>;
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
  appliedTransactionCounts,
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
  prepareApplyPreview,
  handleApply,
  handleUndoApply,
}) => {
  const styles = useStyles();
  const showLoadingPlaceholder = useDelayedBusyState(
    loading && Boolean(currentAction) && !streamingContent && !streamingThinking
  );

  if (messages.length === 0 && !streamingContent) {
    return null;
  }

  return (
    <div className={styles.chatViewport}>
      <div
        className={styles.chatContainer}
        ref={chatContainerRef}
        onScroll={handleChatScroll}
        role="log"
        aria-live="polite"
        aria-label="对话记录"
      >
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            expandedThinking={expandedThinking}
            editingMessageIds={editingMessageIds}
            appliedMessageIds={appliedMessageIds}
            applyingMessageIds={applyingMessageIds}
            undoableMessageIds={undoableMessageIds}
            appliedTransactionCounts={appliedTransactionCounts}
            styles={styles}
            toggleThinking={toggleThinking}
            toggleEditing={toggleEditing}
            handleUpdateMessage={handleUpdateMessage}
            prepareApplyPreview={prepareApplyPreview}
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
                  <div className={styles.assistantContent}>{streamingContent}</div>
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

        {showLoadingPlaceholder && (
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
