import {
  getDocumentOoxml,
} from "../../../utils/wordApi";
import {
  callAIWithToolsStream,
  type AIResponse,
  type StreamChunkMeta,
} from "../../../utils/aiService";
import type { ToolCallRequest, ToolCallResult, ToolDefinition } from "../../../types/tools";
import {
  getActionDef,
  type ActionId,
} from "../../../utils/actionRegistry";
import { runAgentAction, runSimpleAction } from "../../../utils/actionRunners";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import type { ActionType, Message } from "./types";
import {
  MAX_TOOL_LOOPS,
  getActionLabel,
  parseTaggedAgentContent,
  isStatusLikeContent,
} from "./types";
import type { AssistantState } from "./useAssistantState";

export function useAgentLoop(state: AssistantState) {
  const {
    setStreamingContent,
    setStreamingThinking,
    setStreamingThinkingExpanded,
    setLoading,
    setCurrentAction,
    setAgentStatus,
    setApplyStatus,
    setMessages,
    setInputText,
    selectedStyle,
    agentStatus,
    conversationManager,
    toolExecutor,
    appliedSnapshotsRef,
    pendingAgentSnapshotRef,
    lastAgentOutputRef,
    agentHasToolOutputsRef,
    wordBusyRef,
    addMessage,
    markApplied,
    requestUserConfirmation,
    inputText,
  } = state;

  const executeToolCalls = async (toolCalls: ToolCallRequest[], action: ActionId) => {
    if (!pendingAgentSnapshotRef.current) {
      try {
        pendingAgentSnapshotRef.current = await getDocumentOoxml();
      } catch (error) {
        console.error("获取文档快照失败:", error);
      }
    }

    const snapshotForUndo = pendingAgentSnapshotRef.current;
    const labelMap: Record<string, string> = {
      insert_text: "插入文本",
      append_text: "追加文本",
      replace_selected_text: "替换选中文本",
    };

    const toolTitle = (toolName: string, index: number): string => {
      const base = labelMap[toolName] ? `${labelMap[toolName]}（${toolName}）` : toolName;
      return `#### 工具调用 ${index + 1}：${base}`;
    };

    const appendAgentToolOutput = (toolName: string, toolIndex: number, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      agentHasToolOutputsRef.current = true;

      // Keep a combined fallback (used when the model returns a short status-only message at the end).
      lastAgentOutputRef.current = lastAgentOutputRef.current
        ? `${lastAgentOutputRef.current.trimEnd()}\n\n${trimmed}`
        : trimmed;

      const messageId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      addMessage({
        id: messageId,
        type: "assistant",
        content: `${toolTitle(toolName, toolIndex)}\n\n${trimmed}`.trimEnd(),
        plainText: sanitizeMarkdownToPlainText(trimmed),
        applyContent: trimmed,
        action,
        uiOnly: true,
        timestamp: new Date(),
      });

      // Tool calls have already modified the document; disable "应用" and allow "撤回" when possible.
      markApplied(messageId);
      if (snapshotForUndo) {
        appliedSnapshotsRef.current.set(messageId, snapshotForUndo);
      }
    };

    const isAutoAppliedTool = (toolName: string): boolean => {
      return ["insert_text", "append_text", "replace_selected_text"].includes(toolName);
    };

    const pushUnique = (arr: string[], value: string) => {
      if (!arr.includes(value)) arr.push(value);
    };

    const formatToolList = (labels: string[]): string => {
      if (labels.length === 0) return "";
      const maxItems = 4;
      if (labels.length <= maxItems) return labels.join("、");
      return `${labels.slice(0, maxItems).join("、")} 等 ${labels.length} 项`;
    };

    const autoAppliedToolLabels: string[] = [];
    const failedToolLabels: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const maybeTextArg =
        call.arguments && typeof call.arguments === "object"
          ? (call.arguments as { text?: unknown }).text
          : undefined;
      let result: ToolCallResult;
      if (call.name === "restore_snapshot") {
        const confirmation = requestUserConfirmation("将把文档恢复到本轮 AI 操作前的状态，是否继续？", {
          defaultWhenUnavailable: false,
        });
        if (!confirmation.confirmed) {
          result = {
            id: call.id,
            name: call.name,
            success: false,
            error: confirmation.usedFallback
              ? "当前环境不支持确认弹窗，已取消恢复操作"
              : "用户取消恢复操作",
          };
        } else {
          result = await toolExecutor.execute(call);
        }
      } else {
        result = await toolExecutor.execute(call);
      }

      conversationManager.addToolResult(result);

      const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
      if (result.success && isAutoAppliedTool(call.name)) {
        pushUnique(autoAppliedToolLabels, toolLabel);
      }
      if (!result.success) {
        pushUnique(failedToolLabels, toolLabel);
      }

      // Display each "text-writing" tool output as its own assistant reply so new content won't overwrite old.
      if (
        result.success
        && typeof maybeTextArg === "string"
        && maybeTextArg.trim()
        && isAutoAppliedTool(call.name)
      ) {
        appendAgentToolOutput(call.name, i, maybeTextArg);
      }
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length === 0) {
      setApplyStatus({
        state: "success",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}`,
      });
      return;
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length > 0) {
      setApplyStatus({
        state: "warning",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}；但以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
      return;
    }

    if (failedToolLabels.length > 0) {
      setApplyStatus({
        state: "error",
        message: `以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
    }
  };

  const runAgentLoop = async (config: {
    tools: ToolDefinition[];
    systemPrompt: string;
    action: ActionId;
  }): Promise<void> => {
    const {
      tools,
      systemPrompt,
      action,
    } = config;
    const actionLabel = getActionLabel(action);
    lastAgentOutputRef.current = null;
    pendingAgentSnapshotRef.current = null;
    agentHasToolOutputsRef.current = false;

    for (let round = 0; round < MAX_TOOL_LOOPS; round++) {
      // Stream the agent output so the user can see progress (similar to other actions).
      setStreamingContent("");
      setStreamingThinking("");
      setStreamingThinkingExpanded(false);

      // Note: tool-call argument streaming (e.g. insert_text.text) is for UI only. We must not
      // treat it as assistant "content" in the conversation history, otherwise the model will
      // see duplicated text in the next round.
      let streamedAssistantContent = "";
      let streamedThinking = "";
      const toolTextByCallId: Record<string, { toolName?: string; text: string }> = {};
      const toolCallOrder: string[] = [];
      let streamedToolCalls: ToolCallRequest[] | undefined;

      const toolTitleInner = (toolName?: string, index?: number): string => {
        const innerLabelMap: Record<string, string> = {
          insert_text: "插入文本",
          append_text: "追加文本",
          replace_selected_text: "替换选中文本",
        };
        const base = toolName ? (innerLabelMap[toolName] ? `${innerLabelMap[toolName]}（${toolName}）` : toolName) : "工具调用";
        const prefix = typeof index === "number" ? `工具调用 ${index + 1}：` : "工具调用：";
        return `#### ${prefix}${base}`;
      };

      const buildStreamingDisplay = (): string => {
        const parts: string[] = [];
        if (streamedAssistantContent.trim()) {
          parts.push(streamedAssistantContent.trimEnd());
        }

        if (toolCallOrder.length > 0) {
          const sections = toolCallOrder.map((callId, idx) => {
            const entry = toolTextByCallId[callId];
            const title = toolTitleInner(entry?.toolName, idx);
            const body = entry?.text ?? "";
            return `${title}\n\n${body}`.trimEnd();
          });
          parts.push(sections.join("\n\n---\n\n"));
        }

        return parts.join("\n\n").trimEnd();
      };

      const onChunk = (
        chunk: string,
        done: boolean,
        isThinking?: boolean,
        meta?: StreamChunkMeta
      ) => {
        if (done) return;
        if (!chunk) return;
        if (isThinking) {
          streamedThinking += chunk;
          setStreamingThinking((prev) => prev + chunk);
        } else {
          if (meta?.kind === "tool_text") {
            const callId = meta.toolCallId || meta.toolName || "tool_call";
            if (!toolTextByCallId[callId]) {
              toolTextByCallId[callId] = { toolName: meta.toolName, text: "" };
              toolCallOrder.push(callId);
            }
            if (!toolTextByCallId[callId].toolName && meta.toolName) {
              toolTextByCallId[callId].toolName = meta.toolName;
            }
            toolTextByCallId[callId].text += chunk;
          } else {
            streamedAssistantContent += chunk;
          }

          // Re-render streaming display so tool calls are grouped even if chunks interleave.
          setStreamingContent(buildStreamingDisplay());
        }
      };

      await callAIWithToolsStream(
        conversationManager.getMessages(),
        tools,
        systemPrompt,
        onChunk,
        (toolCalls) => {
          streamedToolCalls = toolCalls;
        }
      );

      // Mirror aiService's <think> handling so the final message doesn't show the tag.
      let thinking: string | undefined =
        streamedThinking.trim().length > 0 ? streamedThinking : undefined;
      let content = streamedAssistantContent;
      if (!thinking && content) {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          thinking = thinkMatch[1].trim();
          content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
        }
      }

      const rawMarkdown = content.trim();
      const plainText = sanitizeMarkdownToPlainText(rawMarkdown);

      const response = {
        content: rawMarkdown,
        rawMarkdown,
        plainText,
        thinking,
        toolCalls: streamedToolCalls,
      };

      const parsedConversation = parseTaggedAgentContent(response.rawMarkdown);
      const conversationContent =
        parsedConversation.contentText
        || parsedConversation.statusText
        || response.rawMarkdown;

      conversationManager.addAssistantMessage(
        conversationContent,
        response.toolCalls,
        response.thinking
      );

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const parsedTagged = parseTaggedAgentContent(response.rawMarkdown);
        const fallbackContent = lastAgentOutputRef.current || "";
        const normalizedContent = parsedTagged.contentText.trim();
        const normalizedStatus = parsedTagged.statusText.trim();
        const inferredStatusText = normalizedContent
          ? sanitizeMarkdownToPlainText(normalizedContent).trim()
          : response.plainText.trim();
        const statusLike = parsedTagged.hasTaggedOutput
          ? !normalizedContent
          : isStatusLikeContent(inferredStatusText);

        // If the agent already executed "text-writing" tools, we've appended each tool output
        // as its own assistant message. Avoid emitting another large fallback message that would
        // duplicate content (and feel like overwriting in the UI).
        const displayContent = normalizedContent
          ? normalizedContent
          : statusLike
            ? (
              agentHasToolOutputsRef.current
                ? (normalizedStatus || inferredStatusText || `${actionLabel}已完成`)
                : (fallbackContent || normalizedStatus || inferredStatusText)
            )
            : (response.rawMarkdown || fallbackContent);

        if (displayContent) {
          const messageId = `${Date.now()}_${round}`;
          addMessage({
            id: messageId,
            type: "assistant",
            content: displayContent,
            plainText: sanitizeMarkdownToPlainText(displayContent),
            thinking: response.thinking,
            action,
            timestamp: new Date(),
          });

          if (pendingAgentSnapshotRef.current) {
            appliedSnapshotsRef.current.set(messageId, pendingAgentSnapshotRef.current);
            markApplied(messageId);
            pendingAgentSnapshotRef.current = null;
          }
        }

        const statusMessage =
          normalizedStatus
          || (statusLike ? inferredStatusText : "")
          || `${actionLabel}已完成`;
        setAgentStatus({ state: "success", message: statusMessage });
        return;
      }

      await executeToolCalls(response.toolCalls, action);
    }

    setAgentStatus({
      state: "error",
      message: `${actionLabel}已达到最大工具调用轮次，请尝试更具体的指令。`,
    });
  };

  const handleAction = async (action: ActionType) => {
    if (!inputText.trim() || !action) return;
    const actionDef = getActionDef(action);
    if (!actionDef) {
      const errorText = `未知操作: ${action}`;
      console.error(errorText);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: errorText,
        plainText: errorText,
        action: null,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }
    const actionLabel = actionDef.label;

    setApplyStatus(null);
    wordBusyRef.current = true;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputText,
      action,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    conversationManager.addUserMessage(inputText);

    const savedInput = inputText;
    setInputText("");
    setLoading(true);
    setCurrentAction(action);
    setStreamingContent("");
    setStreamingThinking("");
    setStreamingThinkingExpanded(false);
    if (actionDef.kind === "agent") {
      setAgentStatus({ state: "running", message: `${actionLabel}处理中...` });
    } else if (agentStatus.state !== "idle") {
      setAgentStatus({ state: "idle" });
    }

    try {
      if (actionDef.kind === "agent") {
        const agentRunner = runAgentAction(action);
        if (!agentRunner) {
          throw new Error(`未找到 Agent 执行器: ${action}`);
        }
        await runAgentLoop({
          tools: agentRunner.getTools(),
          systemPrompt: agentRunner.getSystemPrompt(),
          action,
        });
      } else {
        const onChunk = (chunk: string, done: boolean, isThinking?: boolean) => {
          if (done) return;
          if (!chunk) return;
          if (isThinking) {
            setStreamingThinking((prev) => prev + chunk);
          } else {
            setStreamingContent((prev) => prev + chunk);
          }
        };
        const result: AIResponse = await runSimpleAction(
          action,
          savedInput,
          selectedStyle,
          onChunk
        );

        const finalText = (result.rawMarkdown ?? result.content).trim();
        const finalPlainText = result.plainText || sanitizeMarkdownToPlainText(finalText);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: "assistant",
          content: finalText,
          plainText: finalPlainText,
          thinking: result.thinking || undefined,
          action,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        conversationManager.addAssistantMessage(
          finalText,
          undefined,
          result.thinking || undefined
        );
        setAgentStatus({ state: "idle" });
      }

      setStreamingContent("");
      setStreamingThinking("");
    } catch (error) {
      console.error("处理失败:", error);
      const errorText = error instanceof Error ? error.message : "处理失败，请重试";
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: errorText,
        plainText: errorText,
        action,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStreamingContent("");
      setStreamingThinking("");
      if (actionDef.kind === "agent") {
        setAgentStatus({ state: "error", message: errorText });
      }
    } finally {
      setLoading(false);
      setCurrentAction(null);
      wordBusyRef.current = false;
    }
  };

  const handleQuickAction = (action: ActionType) => {
    state.setSelectedAction(action);
    if (inputText.trim()) {
      void handleAction(action);
    }
  };

  const handleSend = () => {
    if (inputText.trim() && state.selectedAction) {
      void handleAction(state.selectedAction);
    }
  };

  return {
    handleAction,
    handleQuickAction,
    handleSend,
  };
}
