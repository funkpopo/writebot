import { useRef } from "react";
import {
  getDocumentOoxml,
} from "../../../utils/wordApi";
import {
  callAI,
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
import { getPrompt } from "../../../utils/promptService";
import { clearAgentPlan, saveAgentPlan } from "../../../utils/storageService";
import { sanitizeMarkdownToPlainText } from "../../../utils/textSanitizer";
import type { ActionType, Message } from "./types";
import {
  getActionLabel,
  parseTaggedAgentContent,
  isStatusLikeContent,
} from "./types";
import {
  ensureTrailingNewlineForInsertion,
  extractPlanStageTitles,
  stripAgentExecutionMarkersFromWriteText,
  type StageWriteGuardContext,
} from "./stageWriteGuard";
import {
  isRetryableWriteToolError,
  MAX_WRITE_TOOL_RETRIES,
} from "./toolRetryPolicy";
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
    setAgentPlanView,
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
  const stopRequestedRef = useRef(false);
  const activeRunIdRef = useRef(0);

  const beginRun = (): number => {
    stopRequestedRef.current = false;
    activeRunIdRef.current += 1;
    return activeRunIdRef.current;
  };

  const isRunCancelled = (runId: number): boolean => {
    return stopRequestedRef.current || activeRunIdRef.current !== runId;
  };

  const PLAN_STATE_TAG = "[[PLAN_STATE]]";

  interface AgentPlanState {
    currentStage: number;
    totalStages: number;
    stageCompleted: boolean;
    allCompleted: boolean;
    nextStage: number;
    reason: string;
  }

  interface GeneratedAgentPlan {
    content: string;
    stageCount: number;
    updatedAt: string;
  }

  const safePositiveInt = (value: unknown, fallback: number): number => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.floor(n));
  };

  const extractJsonBlock = (source: string): Record<string, unknown> | null => {
    const trimmed = source.trim();
    if (!trimmed) return null;

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonLike = fencedMatch?.[1] ?? trimmed;
    const objectMatch = jsonLike.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const parsePlanStateBlock = (rawContent: string): {
    planState: AgentPlanState | null;
    cleanedContent: string;
  } => {
    const source = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
    const stateIndex = source.indexOf(PLAN_STATE_TAG);
    if (stateIndex < 0) {
      return { planState: null, cleanedContent: source };
    }

    const afterTag = source.slice(stateIndex + PLAN_STATE_TAG.length);
    const statusIndexInAfter = afterTag.indexOf("[[STATUS]]");
    const contentIndexInAfter = afterTag.indexOf("[[CONTENT]]");
    const cutPoints = [statusIndexInAfter, contentIndexInAfter].filter((idx) => idx >= 0);
    const stateEndIndex = cutPoints.length > 0 ? Math.min(...cutPoints) : afterTag.length;

    const stateBlock = afterTag.slice(0, stateEndIndex).trim();
    const suffix = afterTag.slice(stateEndIndex).trimStart();
    const prefix = source.slice(0, stateIndex).trimEnd();
    const cleanedContent = [prefix, suffix].filter(Boolean).join("\n\n");

    const parsed = extractJsonBlock(stateBlock);
    if (!parsed) {
      return {
        planState: null,
        cleanedContent,
      };
    }

    const stageCompleted = Boolean(parsed.stageCompleted);
    const allCompleted = Boolean(parsed.allCompleted);
    const currentStage = safePositiveInt(parsed.currentStage, 1);
    const totalStages = safePositiveInt(parsed.totalStages, currentStage);
    const nextStage = safePositiveInt(
      parsed.nextStage,
      stageCompleted ? Math.min(currentStage + 1, totalStages) : currentStage
    );
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

    return {
      planState: {
        currentStage,
        totalStages,
        stageCompleted,
        allCompleted,
        nextStage,
        reason,
      },
      cleanedContent,
    };
  };

  const countPlanStages = (planMarkdown: string): number => {
    const rawLines = planMarkdown.split(/\r?\n/g);

    const stageLineCount = rawLines.filter((rawLine) => {
      // 跳过缩进行（子项）
      if (/^\s{2,}/.test(rawLine)) return false;
      const line = rawLine.trim();
      if (!line) return false;
      return /^(\d+)\.\s*(\[[ xX]\]\s*)?/.test(line) || /^[-*]\s*\[[ xX]\]\s+/.test(line);
    }).length;

    return Math.max(1, stageLineCount);
  };

  const ensurePlanMarkdown = (rawPlanMarkdown: string, userRequirement: string): string => {
    const trimmed = rawPlanMarkdown.trim();
    if (!trimmed) {
      return [
        "# plan.md",
        "",
        "## 用户需求",
        userRequirement,
        "",
        "## 阶段计划",
        "1. [ ] 需求分析与文档准备",
        "2. [ ] 执行文档修改",
        "3. [ ] 校验与收尾",
        "",
        "## 阶段完成标准",
        "- 每个阶段均有可验证产出。",
      ].join("\n");
    }

    if (trimmed.toLowerCase().startsWith("# plan.md")) {
      return trimmed;
    }

    return `# plan.md\n\n${trimmed}`;
  };

  const buildAgentExecutionSystemPrompt = (params: {
    basePrompt: string;
    plan: GeneratedAgentPlan;
    currentStage: number;
  }): string => {
    const { basePrompt, plan, currentStage } = params;
    return `${basePrompt}

你必须严格按照持久化的 plan.md 执行任务。
当前阶段：第 ${currentStage} 阶段（共 ${plan.stageCount} 阶段）

以下是 plan.md 完整内容：
\`\`\`markdown
${plan.content}
\`\`\`

执行规则（必须遵守）：
1. 每一轮只处理当前阶段；先判断当前阶段是否完成，再决定是否进入下一阶段。
2. 若当前阶段未完成，继续完善当前阶段，不要跳阶段。
3. 若当前阶段已完成且未全部完成，进入下一阶段继续执行。
4. 涉及文档写入时必须调用工具（insert_text / replace_selected_text / append_text 等），不要只输出正文。
5. 严禁重复写入：前几轮已通过工具写入文档的内容不得再次写入。每轮只写入新增内容，不要把之前已写入的段落重新 append。
6. 写入工具的 text 参数只能包含最终文档正文，不得包含“第X阶段/当前阶段/阶段总结”等过程标记。
7. 使用 insert_text / append_text 时，text 末尾必须带换行符（\\n），确保下次写入从新行开始。
8. 每轮回复都必须包含以下标签：
[[PLAN_STATE]]
{
  "currentStage": number,
  "totalStages": number,
  "stageCompleted": boolean,
  "allCompleted": boolean,
  "nextStage": number,
  "reason": "一句话说明判断依据（引用 plan.md 阶段完成标准）"
}

[[STATUS]]
一句状态说明

[[CONTENT]]
可交付内容摘要（仅用于界面展示，不要将阶段总结或完成报告通过 append_text / insert_text 写入文档。写入工具只用于写入正式文档内容。）`;
  };

  const generateAndPersistAgentPlan = async (
    userRequirement: string
  ): Promise<GeneratedAgentPlan> => {
    const plannerPrompt = getPrompt("assistant_agent_planner");
    const plannerResult = await callAI(
      `请根据以下用户需求生成 plan.md：\n\n${userRequirement}`,
      plannerPrompt
    );
    const planMarkdown = ensurePlanMarkdown(
      (plannerResult.rawMarkdown ?? plannerResult.content).trim(),
      userRequirement
    );
    const stageCount = countPlanStages(planMarkdown);
    const savedPlan = await saveAgentPlan({
      content: planMarkdown,
      request: userRequirement,
      stageCount,
    });

    return {
      content: savedPlan.content,
      stageCount: savedPlan.stageCount || stageCount,
      updatedAt: savedPlan.updatedAt,
    };
  };

  const executeToolCalls = async (
    toolCalls: ToolCallRequest[],
    action: ActionId,
    runId: number,
    writtenSegments?: string[],
    stageWriteGuard?: StageWriteGuardContext
  ) => {
    if (isRunCancelled(runId)) return;
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

    const shouldForceTrailingNewline = (toolName: string): boolean => {
      return toolName === "insert_text" || toolName === "append_text";
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

    const waitForMs = (ms: number): Promise<void> => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };

    const executeSingleToolCall = async (callToRun: ToolCallRequest): Promise<ToolCallResult> => {
      if (callToRun.name === "restore_snapshot") {
        const confirmation = requestUserConfirmation("将把文档恢复到本轮 AI 操作前的状态，是否继续？", {
          defaultWhenUnavailable: false,
        });
        if (!confirmation.confirmed) {
          return {
            id: callToRun.id,
            name: callToRun.name,
            success: false,
            error: confirmation.usedFallback
              ? "当前环境不支持确认弹窗，已取消恢复操作"
              : "用户取消恢复操作",
          };
        }
      }
      return toolExecutor.execute(callToRun);
    };

    const autoAppliedToolLabels: string[] = [];
    const failedToolLabels: string[] = [];
    const retriedSuccessToolLabels: string[] = [];
    const retryExhaustedToolLabels: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      if (isRunCancelled(runId)) return;
      const call = toolCalls[i];
      const rawTextArg =
        call.arguments && typeof call.arguments === "object"
          ? (call.arguments as { text?: unknown }).text
          : undefined;
      const autoApplied = isAutoAppliedTool(call.name);
      let maybeTextArg = typeof rawTextArg === "string" ? rawTextArg : undefined;
      let callToExecute = call;

      if (autoApplied && typeof maybeTextArg === "string" && maybeTextArg.trim() && stageWriteGuard) {
        const guardResult = stripAgentExecutionMarkersFromWriteText(maybeTextArg, stageWriteGuard);
        if (guardResult.removedMarker) {
          maybeTextArg = guardResult.text;
          callToExecute = {
            ...call,
            arguments: {
              ...(call.arguments || {}),
              text: guardResult.text,
            },
          };
          console.warn(`[agent] Removed stage marker before ${call.name} write`);
        }
      }

      if (shouldForceTrailingNewline(call.name) && typeof maybeTextArg === "string" && maybeTextArg.trim()) {
        const normalizedText = ensureTrailingNewlineForInsertion(maybeTextArg);
        if (normalizedText !== maybeTextArg) {
          maybeTextArg = normalizedText;
          callToExecute = {
            ...callToExecute,
            arguments: {
              ...(callToExecute.arguments || {}),
              text: normalizedText,
            },
          };
        }
      }

      let result: ToolCallResult;
      let retryCount = 0;

      if (autoApplied && typeof maybeTextArg === "string" && !maybeTextArg.trim()) {
        result = {
          id: call.id,
          name: call.name,
          success: true,
          result: "仅检测到阶段指示内容，已跳过写入",
        };
        conversationManager.addToolResult(result);
        continue;
      }

      // ── Deduplication: skip write-tool calls whose content was already written ──
      if (
        autoApplied
        && typeof maybeTextArg === "string"
        && maybeTextArg.trim()
      ) {
        const trimmedNew = maybeTextArg.trim();
        const isDuplicate =
          (writtenSegments ?? []).some((seg: string) => seg === trimmedNew);
        if (isDuplicate) {
          result = {
            id: call.id,
            name: call.name,
            success: true,
            result: "该内容已存在于文档中，已跳过重复写入",
          };
          conversationManager.addToolResult(result);
          console.warn(`[agent] Skipped duplicate ${call.name} (content already written)`);
          continue;
        }
      }

      if (autoApplied) {
        while (true) {
          result = await executeSingleToolCall(callToExecute);
          if (result.success) break;

          const canRetry =
            retryCount < MAX_WRITE_TOOL_RETRIES && isRetryableWriteToolError(result.error);
          if (!canRetry) break;

          retryCount += 1;
          const delayMs = Math.min(300 * retryCount, 1200);
          console.warn(
            `[agent] ${call.name} 执行失败，准备重试 ${retryCount}/${MAX_WRITE_TOOL_RETRIES}`,
            result.error
          );
          await waitForMs(delayMs);
        }
      } else {
        result = await executeSingleToolCall(callToExecute);
      }

      conversationManager.addToolResult(result);

      const toolLabel = labelMap[call.name] ? `${labelMap[call.name]}（${call.name}）` : call.name;
      if (retryCount > 0) {
        if (result.success) {
          pushUnique(retriedSuccessToolLabels, toolLabel);
        } else {
          pushUnique(retryExhaustedToolLabels, toolLabel);
        }
      }
      if (result.success && autoApplied) {
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
        && autoApplied
      ) {
        appendAgentToolOutput(call.name, i, maybeTextArg);
        // Track written content for cross-round deduplication.
        writtenSegments?.push(maybeTextArg.trim());
      }
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length === 0) {
      const retrySuffix =
        retriedSuccessToolLabels.length > 0
          ? `（其中 ${formatToolList(retriedSuccessToolLabels)} 为重试后成功）`
          : "";
      setApplyStatus({
        state: "success",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}${retrySuffix}`,
      });
      return;
    }

    if (autoAppliedToolLabels.length > 0 && failedToolLabels.length > 0) {
      const retrySuffix =
        retriedSuccessToolLabels.length > 0
          ? `（部分工具重试成功：${formatToolList(retriedSuccessToolLabels)}）`
          : "";
      setApplyStatus({
        state: "warning",
        message: `已执行：${formatToolList(autoAppliedToolLabels)}${retrySuffix}；但以下执行失败：${formatToolList(failedToolLabels)}。`,
      });
      return;
    }

    if (failedToolLabels.length > 0) {
      const retryHint =
        retryExhaustedToolLabels.length > 0
          ? `（已自动重试仍失败：${formatToolList(retryExhaustedToolLabels)}）`
          : "";
      setApplyStatus({
        state: "error",
        message: `以下执行失败：${formatToolList(failedToolLabels)}${retryHint}。`,
      });
    }
  };

  const runAgentLoop = async (config: {
    tools: ToolDefinition[];
    systemPrompt: string;
    action: ActionId;
    plan: GeneratedAgentPlan;
    runId: number;
  }): Promise<void> => {
    const {
      tools,
      systemPrompt,
      action,
      plan,
      runId,
    } = config;
    const actionLabel = getActionLabel(action);
    let currentStage = 1;
    const planStageTitles = extractPlanStageTitles(plan.content);
    const syncPlanView = (params: {
      nextCurrentStage: number;
      nextTotalStages: number;
      completeStage?: number;
      completeThroughStage?: number;
    }) => {
      const {
        nextCurrentStage,
        nextTotalStages,
        completeStage,
        completeThroughStage,
      } = params;
      setAgentPlanView((prev) => ({
        content: plan.content,
        currentStage: Math.max(1, nextCurrentStage),
        totalStages: Math.max(1, nextTotalStages),
        completedStages: (() => {
          const base = new Set<number>(prev?.completedStages ?? []);
          if (typeof completeThroughStage === "number") {
            for (let i = 1; i <= Math.max(1, Math.floor(completeThroughStage)); i++) {
              base.add(i);
            }
          }
          if (typeof completeStage === "number" && completeStage > 0) {
            base.add(Math.floor(completeStage));
          }
          return Array.from(base).sort((a, b) => a - b);
        })(),
        updatedAt: plan.updatedAt,
      }));
    };

    syncPlanView({
      nextCurrentStage: currentStage,
      nextTotalStages: plan.stageCount,
    });
    lastAgentOutputRef.current = null;
    pendingAgentSnapshotRef.current = null;
    agentHasToolOutputsRef.current = false;

    // Track content written to the document across rounds to prevent duplicate writes.
    const writtenContentSegments: string[] = [];
    // 连续未返回 [[PLAN_STATE]] 的轮次计数，超过阈值则视为完成
    let missingPlanStateRetries = 0;
    const MAX_MISSING_PLAN_STATE_RETRIES = 2;

    while (true) {
      if (isRunCancelled(runId)) return;
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
        if (isRunCancelled(runId)) return;
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

      const roundSystemPrompt = buildAgentExecutionSystemPrompt({
        basePrompt: systemPrompt,
        plan,
        currentStage,
      });

      await callAIWithToolsStream(
        conversationManager.getMessages(),
        tools,
        roundSystemPrompt,
        onChunk,
        (toolCalls) => {
          if (isRunCancelled(runId)) return;
          streamedToolCalls = toolCalls;
        }
      );
      if (isRunCancelled(runId)) return;

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
      const { planState, cleanedContent } = parsePlanStateBlock(rawMarkdown);
      const normalizedRawMarkdown = cleanedContent.trim();
      const plainText = sanitizeMarkdownToPlainText(normalizedRawMarkdown);

      const response = {
        content: normalizedRawMarkdown,
        rawMarkdown: normalizedRawMarkdown,
        plainText,
        thinking,
        toolCalls: streamedToolCalls,
      };

      if (planState) {
        const observedTotalStages = Math.max(plan.stageCount, planState.totalStages);
        const observedCurrentStage = Math.min(
          Math.max(planState.currentStage, 1),
          observedTotalStages
        );
        syncPlanView({
          nextCurrentStage: observedCurrentStage,
          nextTotalStages: observedTotalStages,
          completeStage: planState.stageCompleted ? observedCurrentStage : undefined,
          completeThroughStage: planState.allCompleted ? observedTotalStages : undefined,
        });
      }

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

      // When a stage is completed, the AI sometimes duplicates the [[CONTENT]] summary
      // into an append_text / insert_text tool call. Filter out such calls so the stage
      // summary doesn't get written into the target document.
      if (
        planState?.stageCompleted
        && response.toolCalls?.length
        && parsedConversation.hasTaggedOutput
      ) {
        const taggedContent = parsedConversation.contentText.trim();
        if (taggedContent) {
          response.toolCalls = response.toolCalls.filter((call) => {
            if (!["append_text", "insert_text", "replace_selected_text"].includes(call.name)) {
              return true;
            }
            const textArg =
              call.arguments && typeof call.arguments === "object"
                ? (call.arguments as { text?: unknown }).text
                : undefined;
            if (typeof textArg !== "string" || !textArg.trim()) return true;
            const trimmedArg = textArg.trim();
            // Drop the tool call only if its text is essentially the same as [[CONTENT]]
            // (exact match or one is a subset of the other AND they are similar in length).
            // Do NOT drop long document writes that merely contain the short summary.
            const lenRatio = Math.min(trimmedArg.length, taggedContent.length)
              / Math.max(trimmedArg.length, taggedContent.length, 1);
            if (
              trimmedArg === taggedContent
              || (lenRatio > 0.5 && (taggedContent.includes(trimmedArg) || trimmedArg.includes(taggedContent)))
            ) {
              console.warn(
                `[agent] Filtered out ${call.name} that duplicates [[CONTENT]] stage summary`
              );
              return false;
            }
            return true;
          });
        }
      }

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

        if (!planState) {
          missingPlanStateRetries++;
          if (missingPlanStateRetries > MAX_MISSING_PLAN_STATE_RETRIES) {
            // 超过重试次数，视为全部完成，直接结束
            const finalContent = normalizedContent || fallbackContent;
            if (finalContent) {
              const messageId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
              addMessage({
                id: messageId,
                type: "assistant",
                content: finalContent,
                plainText: sanitizeMarkdownToPlainText(finalContent),
                action,
                timestamp: new Date(),
              });
              if (pendingAgentSnapshotRef.current) {
                appliedSnapshotsRef.current.set(messageId, pendingAgentSnapshotRef.current);
                markApplied(messageId);
                pendingAgentSnapshotRef.current = null;
              }
            }
            syncPlanView({
              nextCurrentStage: plan.stageCount,
              nextTotalStages: plan.stageCount,
              completeThroughStage: plan.stageCount,
            });
            setAgentStatus({ state: "success", message: normalizedStatus || `${actionLabel}已完成` });
            return;
          }
          setAgentStatus({
            state: "running",
            message: normalizedStatus || "正在根据 plan 校验阶段完成状态...",
          });
          conversationManager.addUserMessage(
            "请严格参考 plan.md，先判断当前阶段完成度，再输出 [[PLAN_STATE]] JSON 后继续执行。"
          );
          continue;
        }

        // 收到有效 planState，重置重试计数
        missingPlanStateRetries = 0;

        const resolvedTotalStages = Math.max(plan.stageCount, planState.totalStages);
        const resolvedCurrentStage = Math.min(
          Math.max(planState.currentStage, currentStage),
          resolvedTotalStages
        );
        const resolvedNextStage = Math.min(
          Math.max(planState.nextStage, resolvedCurrentStage),
          resolvedTotalStages
        );

        if (!planState.allCompleted) {
          const stageCompleted = planState.stageCompleted;
          const targetStage = stageCompleted
            ? Math.min(
              Math.max(resolvedNextStage, resolvedCurrentStage + 1),
              resolvedTotalStages
            )
            : resolvedCurrentStage;

          currentStage = targetStage;
          syncPlanView({
            nextCurrentStage: currentStage,
            nextTotalStages: resolvedTotalStages,
            completeStage: stageCompleted ? resolvedCurrentStage : undefined,
          });

          if (normalizedContent) {
            lastAgentOutputRef.current = normalizedContent;
          }
          const runningStatus = normalizedStatus
            || planState.reason
            || (
              stageCompleted
                ? `阶段 ${resolvedCurrentStage} 已完成，继续阶段 ${targetStage}`
                : `阶段 ${resolvedCurrentStage} 未完成，继续完善`
            );
          setAgentStatus({ state: "running", message: runningStatus });

          if (stageCompleted) {
            conversationManager.addUserMessage(
              `请按照 plan.md 继续执行第 ${targetStage} 阶段，并在结束时再次输出 [[PLAN_STATE]]。`
            );
          } else {
            conversationManager.addUserMessage(
              `请继续完善 plan.md 的第 ${resolvedCurrentStage} 阶段，必要时调用写入工具并在结束时输出 [[PLAN_STATE]]。`
            );
          }
          continue;
        }

        currentStage = resolvedCurrentStage;
        syncPlanView({
          nextCurrentStage: resolvedTotalStages,
          nextTotalStages: resolvedTotalStages,
          completeThroughStage: resolvedTotalStages,
        });
        if (normalizedContent) {
          lastAgentOutputRef.current = normalizedContent;
        }

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
          const messageId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
        syncPlanView({
          nextCurrentStage: resolvedTotalStages,
          nextTotalStages: resolvedTotalStages,
          completeThroughStage: resolvedTotalStages,
        });
        setAgentStatus({ state: "success", message: statusMessage });
        if (parsedTagged.hasTaggedOutput && normalizedContent && !agentHasToolOutputsRef.current) {
          setApplyStatus({
            state: "warning",
            message: "本次回复未调用写入工具，内容尚未写入文档，可点击“应用”插入。",
          });
        }
        return;
      }

      await executeToolCalls(response.toolCalls, action, runId, writtenContentSegments, {
        currentStage,
        totalStages: plan.stageCount,
        planStageTitles,
      });
      if (isRunCancelled(runId)) return;

      // Reset snapshot so the next round captures the document state *after* this round's
      // changes. Without this, every round shares the same pre-round-1 snapshot, which
      // causes undo to revert ALL rounds and can lead to content duplication.
      pendingAgentSnapshotRef.current = null;
    }
  };

  const handleAction = async (action: ActionType) => {
    if (!inputText.trim() || !action) return;
    const runId = beginRun();
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
    setApplyStatus(null);
    if (actionDef.kind === "agent") {
      setAgentPlanView(null);
      await clearAgentPlan();
      setAgentStatus({ state: "idle" });
    }
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
    if (actionDef.kind !== "agent" && agentStatus.state !== "idle") {
      setAgentStatus({ state: "idle" });
    }

    try {
      if (actionDef.kind === "agent") {
        const agentRunner = runAgentAction(action);
        if (!agentRunner) {
          throw new Error(`未找到 Agent 执行器: ${action}`);
        }
        setAgentStatus({ state: "running", message: "正在分析需求并生成 plan..." });
        const generatedPlan = await generateAndPersistAgentPlan(savedInput);
        setAgentPlanView({
          content: generatedPlan.content,
          currentStage: 1,
          totalStages: generatedPlan.stageCount,
          completedStages: [],
          updatedAt: generatedPlan.updatedAt,
        });
        setAgentStatus({
          state: "running",
          message: `已生成阶段计划，开始执行阶段 1/${generatedPlan.stageCount}...`,
        });
        await runAgentLoop({
          tools: agentRunner.getTools(),
          systemPrompt: agentRunner.getSystemPrompt(),
          action,
          plan: generatedPlan,
          runId,
        });
      } else {
        const onChunk = (chunk: string, done: boolean, isThinking?: boolean) => {
          if (isRunCancelled(runId)) return;
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
        if (isRunCancelled(runId)) return;

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
      if (isRunCancelled(runId)) return;
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
      if (activeRunIdRef.current === runId) {
        setLoading(false);
        setCurrentAction(null);
        wordBusyRef.current = false;
      }
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

  const handleStop = () => {
    if (!state.loading) return;
    stopRequestedRef.current = true;
    activeRunIdRef.current += 1;
    setLoading(false);
    setCurrentAction(null);
    setStreamingContent("");
    setStreamingThinking("");
    setStreamingThinkingExpanded(false);
    setAgentStatus({ state: "idle" });
    wordBusyRef.current = false;
  };

  return {
    handleAction,
    handleQuickAction,
    handleSend,
    handleStop,
  };
}
