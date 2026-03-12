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
import { buildApplyPreviewSegments, mergeApplyPreviewSegments } from "./applyPreview";

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
  const previewSegments = React.useMemo(
    () => buildApplyPreviewSegments(message.content),
    [message.content]
  );
  const [applyPreviewOpen, setApplyPreviewOpen] = React.useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = React.useState<Set<string>>(
    () => new Set(previewSegments.map((segment) => segment.id))
  );
  const isApplied = appliedMessageIds.has(message.id);
  const isApplying = applyingMessageIds.has(message.id);

  React.useEffect(() => {
    setSelectedSegmentIds(new Set(previewSegments.map((segment) => segment.id)));
  }, [previewSegments]);

  React.useEffect(() => {
    if (isApplied) {
      setApplyPreviewOpen(false);
    }
  }, [isApplied]);

  const selectedCount = React.useMemo(
    () => previewSegments.filter((segment) => selectedSegmentIds.has(segment.id)).length,
    [previewSegments, selectedSegmentIds]
  );

  const selectedPreviewContent = React.useMemo(
    () => mergeApplyPreviewSegments(previewSegments, selectedSegmentIds),
    [previewSegments, selectedSegmentIds]
  );

  const togglePreviewSegment = (segmentId: string) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  const selectAllPreviewSegments = () => {
    setSelectedSegmentIds(new Set(previewSegments.map((segment) => segment.id)));
  };

  const clearPreviewSegments = () => {
    setSelectedSegmentIds(new Set());
  };

  const handleApplyPreview = () => {
    if (!applyPreviewOpen) {
      setApplyPreviewOpen(true);
      return;
    }

    if (!selectedPreviewContent.trim()) {
      return;
    }

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
            {getActionLabel(message.action || null)} · 原文
          </Text>
          <div className={mergeClasses(styles.messageBubble, styles.userBubble)}>
            {formatOriginalTextForBubble(message.content)}
          </div>
        </>
      ) : (
        <>
          <Text className={styles.messageLabel}>
            {getActionLabel(message.action || null)} · 结果
          </Text>
          <Card className={styles.assistantCard}>
            {message.thinking && (
              <div className={styles.thinkingSection}>
                <div
                  className={styles.thinkingHeader}
                  onClick={() => toggleThinking(message.id)}
                >
                  <Brain24Regular className={styles.thinkingIcon} />
                  <Text className={styles.thinkingLabel}>思维过程</Text>
                  {expandedThinking.has(message.id) ? (
                    <ChevronUp24Regular />
                  ) : (
                    <ChevronDown24Regular />
                  )}
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
                      共 {previewSegments.length} 段，已保留 {selectedCount} 段
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
                              第 {index + 1} 段
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
                          <Button
                            appearance={selected ? "secondary" : "primary"}
                            size="small"
                            onClick={() => togglePreviewSegment(segment.id)}
                          >
                            {selected ? "拒绝本段" : "恢复本段"}
                          </Button>
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
                      只会写入当前保留的段落
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
                onClick={handleApplyPreview}
                disabled={
                  !message.content.trim()
                  || isApplied
                  || isApplying
                  || (applyPreviewOpen && !selectedPreviewContent.trim())
                }
              >
                {isApplying
                  ? "应用中..."
                  : applyPreviewOpen
                    ? `应用已选 (${selectedCount})`
                    : "应用前预览"}
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
              {getActionLabel(currentAction)} · 生成中...
            </Text>
            <Card className={styles.assistantCard}>
              {streamingThinking && (
                <div className={styles.thinkingSection}>
                  <div
                    className={styles.thinkingHeader}
                    onClick={() => setStreamingThinkingExpanded((prev) => !prev)}
                  >
                    <Brain24Regular className={styles.thinkingIcon} />
                    <Text className={styles.thinkingLabel}>思维过程</Text>
                    {streamingThinkingExpanded ? <ChevronUp24Regular /> : <ChevronDown24Regular />}
                    <Spinner size="tiny" />
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
                  <div className={styles.assistantContent}>正在思考...</div>
                )}
              </div>
            </Card>
          </div>
        )}

        {loading && currentAction === "agent" && !streamingContent && !streamingThinking && (
          <div className={mergeClasses(styles.messageWrapper, styles.assistantMessageWrapper)}>
            <Text className={styles.messageLabel}>智能需求 · 生成中...</Text>
            <Card className={styles.assistantCard}>
              <div className={styles.assistantCardContent}>
                <div className={styles.assistantContent}>正在思考...</div>
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
