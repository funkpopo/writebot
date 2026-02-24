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
  handleApply: (message: Message) => Promise<void>;
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
            {!message.uiOnly && (
            <div className={styles.assistantActions}>
              <Button
                className={styles.actionButton}
                appearance="primary"
                size="small"
                icon={
                  applyingMessageIds.has(message.id)
                    ? <Spinner size="tiny" />
                    : <ArrowSync24Regular />
                }
                onClick={() => handleApply(message)}
                disabled={
                  !message.content.trim()
                  || appliedMessageIds.has(message.id)
                  || applyingMessageIds.has(message.id)
                }
              >
                {applyingMessageIds.has(message.id) ? "应用中..." : "应用"}
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
                {editingMessageIds.has(message.id) ? "预览" : "编辑"}
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
  handleApply: (message: Message) => Promise<void>;
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
