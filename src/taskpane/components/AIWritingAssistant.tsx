import * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useStyles } from "./assistant/styles";
import { useAssistantState } from "./assistant/useAssistantState";
import { useAgentLoop } from "./assistant/useAgentLoop";
import { WelcomeSection } from "./assistant/WelcomeSection";
import { ChatList } from "./assistant/ChatList";
import { StatusBar } from "./assistant/StatusBar";
import { Composer } from "./assistant/Composer";
import { ChangeTimeline } from "./assistant/ChangeTimeline";
import {
  getAssistantModuleById,
  getEnabledAssistantModules,
} from "../../utils/assistantModuleService";
import {
  getAndClearRibbonCommandRequest,
  getRibbonCommandRequestKey,
} from "../../utils/storageService";

const OutlineConfirmation = React.lazy(() =>
  import("./assistant/multiAgent/OutlineConfirmation").then((module) => ({
    default: module.OutlineConfirmation,
  }))
);

const AIWritingAssistant: React.FC = () => {
  const styles = useStyles();
  const state = useAssistantState();
  const { handleAction, handleQuickAction, handleSend, handleStop } = useAgentLoop(state);
  const assistantModules = useMemo(() => getEnabledAssistantModules(), []);
  const handleActionRef = useRef(handleAction);

  handleActionRef.current = handleAction;

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
    appliedTransactionsRef,
    currentAction,
    loading,
    chatContainerRef,
    handleChatScroll,
    showScrollToBottomButton,
    handleScrollToBottom,
    agentStatus,
    applyStatus,
    agentPlanView,
    changeTimeline,
    setChangeTimelineOpen,
    refreshChangeTimeline,
    previewTimelineRollback,
    rollbackTimelineTransaction,
    rollbackTimelineGroup,
    inputText,
    setInputText,
    selectedAction,
    setSelectedAction,
    selectedStyle,
    setSelectedStyle,
    selectedTranslationTarget,
    setSelectedTranslationTarget,
    agentPermissionMode,
    toggleThinking,
    toggleEditing,
    handleUpdateMessage,
    prepareApplyPreview,
    handleApply,
    handleUndoApply,
    handleGetSelection,
    handleClearChat,
    handleSelectAgentPermissionMode,
    multiAgentPhase,
    multiAgentOutline,
    outlineConfirmResolverRef,
  } = state;

  useEffect(() => {
    const consumeRibbonRequest = async () => {
      const request = await getAndClearRibbonCommandRequest();
      if (!request) return;
      const moduleDef = getAssistantModuleById(request.action);
      if (!moduleDef) return;
      setSelectedAction(request.action);
      setInputText(request.inputText || "");
      await handleActionRef.current(request.action, request.inputText || "");
    };

    void consumeRibbonRequest();

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== getRibbonCommandRequestKey() || !event.newValue) return;
      void consumeRibbonRequest();
    };

    window.addEventListener("storage", handleStorage);

    const officeStorage = typeof OfficeRuntime !== "undefined" ? OfficeRuntime.storage : undefined;
    const handleOfficeStorageChange = (args: {
      changedItems?: Array<{ key: string; newValue?: string }> | Record<string, { newValue?: string }>;
    }) => {
      const key = getRibbonCommandRequestKey();
      const changedItems = args?.changedItems;
      if (Array.isArray(changedItems)) {
        if (changedItems.some((item) => item.key === key && item.newValue)) {
          void consumeRibbonRequest();
        }
        return;
      }
      if (changedItems && typeof changedItems === "object") {
        if (changedItems[key]?.newValue) {
          void consumeRibbonRequest();
        }
      }
    };

    if (officeStorage?.onChanged?.addListener) {
      officeStorage.onChanged.addListener(handleOfficeStorageChange);
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      if (officeStorage?.onChanged?.removeListener) {
        officeStorage.onChanged.removeListener(handleOfficeStorageChange);
      }
    };
  }, [setInputText, setSelectedAction]);

  // Derive undoable message IDs from the transaction ref so sub-components don't access refs during render.
  const undoableMessageIds = useMemo(
    () => new Set(appliedTransactionsRef.current.keys()),
    // Re-derive whenever appliedMessageIds changes (it tracks the same lifecycle as transaction handles).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appliedMessageIds]
  );
  const appliedTransactionCounts = useMemo(
    () => {
      const counts = new Map<string, number>();
      for (const [messageId, handle] of appliedTransactionsRef.current.entries()) {
        counts.set(messageId, handle.transactionIds.length);
      }
      return counts;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appliedMessageIds]
  );
  const currentActionLabel = getAssistantModuleById(currentAction)?.label;

  return (
    <div className={styles.container}>
      {messages.length === 0 && !streamingContent && (
        <WelcomeSection modules={assistantModules} handleQuickAction={handleQuickAction} />
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
          appliedTransactionCounts={appliedTransactionCounts}
          currentAction={currentAction}
          currentActionLabel={currentActionLabel}
          loading={loading}
          chatContainerRef={chatContainerRef}
          handleChatScroll={handleChatScroll}
          showScrollToBottomButton={showScrollToBottomButton}
          handleScrollToBottom={handleScrollToBottom}
          toggleThinking={toggleThinking}
          toggleEditing={toggleEditing}
          handleUpdateMessage={handleUpdateMessage}
          prepareApplyPreview={prepareApplyPreview}
          handleApply={handleApply}
          handleUndoApply={handleUndoApply}
        />
      )}

      {multiAgentPhase === "awaiting_confirmation" && multiAgentOutline && (
        <React.Suspense fallback={null}>
          <OutlineConfirmation
            outline={multiAgentOutline}
            onConfirm={() => {
              outlineConfirmResolverRef.current?.(true);
              outlineConfirmResolverRef.current = null;
            }}
            onCancel={() => {
              outlineConfirmResolverRef.current?.(false);
              outlineConfirmResolverRef.current = null;
            }}
          />
        </React.Suspense>
      )}

      <StatusBar
        agentStatus={agentStatus}
        applyStatus={applyStatus}
        agentPlanView={agentPlanView}
        multiAgentPhase={multiAgentPhase}
      />

      <ChangeTimeline
        open={changeTimeline.open}
        transactions={changeTimeline.transactions}
        loading={changeTimeline.loading}
        selectedPreview={changeTimeline.selectedPreview}
        previewingTransactionId={changeTimeline.previewingTransactionId}
        onToggleOpen={setChangeTimelineOpen}
        onRefresh={refreshChangeTimeline}
        onPreviewRollback={previewTimelineRollback}
        onRollbackTransaction={rollbackTimelineTransaction}
        onRollbackGroup={rollbackTimelineGroup}
      />

      <Composer
        inputText={inputText}
        setInputText={setInputText}
        selectedAction={selectedAction}
        setSelectedAction={setSelectedAction}
        selectedStyle={selectedStyle}
        setSelectedStyle={setSelectedStyle}
        selectedTranslationTarget={selectedTranslationTarget}
        setSelectedTranslationTarget={setSelectedTranslationTarget}
        agentPermissionMode={agentPermissionMode}
        modules={assistantModules}
        loading={loading}
        messagesLength={messages.length}
        handleGetSelection={handleGetSelection}
        handleClearChat={handleClearChat}
        handleSelectAgentPermissionMode={handleSelectAgentPermissionMode}
        handleSend={handleSend}
        handleStop={handleStop}
      />
    </div>
  );
};

export default AIWritingAssistant;
