import * as React from "react";
import { useMemo } from "react";
import { useStyles } from "./assistant/styles";
import { useAssistantState } from "./assistant/useAssistantState";
import { useAgentLoop } from "./assistant/useAgentLoop";
import { WelcomeSection } from "./assistant/WelcomeSection";
import { ChatList } from "./assistant/ChatList";
import { StatusBar } from "./assistant/StatusBar";
import { Composer } from "./assistant/Composer";

const AIWritingAssistant: React.FC = () => {
  const styles = useStyles();
  const state = useAssistantState();
  const { handleQuickAction, handleSend, handleStop } = useAgentLoop(state);

  const {
    messages,
    streamingContent,
    streamingThinking,
    streamingThinkingExpanded,
    setStreamingThinkingExpanded,
    expandedThinking,
    editingMessageIds,
    appliedMessageIds,
    applyingMessageIds,
    appliedSnapshotsRef,
    currentAction,
    loading,
    chatContainerRef,
    agentStatus,
    applyStatus,
    agentPlanView,
    inputText,
    setInputText,
    selectedAction,
    setSelectedAction,
    selectedStyle,
    setSelectedStyle,
    toggleThinking,
    toggleEditing,
    handleUpdateMessage,
    handleApply,
    handleUndoApply,
    handleGetSelection,
    handleClearChat,
  } = state;

  // Derive undoable message IDs from the snapshots ref so sub-components don't access refs during render.
  const undoableMessageIds = useMemo(
    () => new Set(appliedSnapshotsRef.current.keys()),
    // Re-derive whenever appliedMessageIds changes (it tracks the same lifecycle as snapshots).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appliedMessageIds]
  );

  return (
    <div className={styles.container}>
      {messages.length === 0 && !streamingContent && (
        <WelcomeSection handleQuickAction={handleQuickAction} />
      )}

      {(messages.length > 0 || streamingContent) && (
        <ChatList
          messages={messages}
          streamingContent={streamingContent}
          streamingThinking={streamingThinking}
          streamingThinkingExpanded={streamingThinkingExpanded}
          setStreamingThinkingExpanded={setStreamingThinkingExpanded}
          expandedThinking={expandedThinking}
          editingMessageIds={editingMessageIds}
          appliedMessageIds={appliedMessageIds}
          applyingMessageIds={applyingMessageIds}
          undoableMessageIds={undoableMessageIds}
          currentAction={currentAction}
          loading={loading}
          chatContainerRef={chatContainerRef}
          toggleThinking={toggleThinking}
          toggleEditing={toggleEditing}
          handleUpdateMessage={handleUpdateMessage}
          handleApply={handleApply}
          handleUndoApply={handleUndoApply}
        />
      )}

      <StatusBar
        agentStatus={agentStatus}
        applyStatus={applyStatus}
        agentPlanView={agentPlanView}
      />

      <Composer
        inputText={inputText}
        setInputText={setInputText}
        selectedAction={selectedAction}
        setSelectedAction={setSelectedAction}
        selectedStyle={selectedStyle}
        setSelectedStyle={setSelectedStyle}
        loading={loading}
        messagesLength={messages.length}
        handleGetSelection={handleGetSelection}
        handleClearChat={handleClearChat}
        handleSend={handleSend}
        handleStop={handleStop}
      />
    </div>
  );
};

export default AIWritingAssistant;
