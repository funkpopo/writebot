/**
 * agentRunController 纯逻辑测试 —— 不 mock React / localStorage。
 */
import { describe, it, expect } from "bun:test";
import {
  appendPendingAgentTransaction,
  createRunControl,
  createStreamingBatcher,
  extractSectionProgressFromMessage,
  MAX_VISIBLE_MESSAGES,
  normalizeStoredConversationMessages,
  pruneVisibleMessages,
  toPlanMarkdownFromOutline,
  toStoredConversationMessages,
  withPlanProgressMeta,
} from "./agentRunController";
import type { ArticleOutline } from "./multiAgent/types";
import type { Message } from "./types";

// ── 流式批处理 ──────────────────────────────────────────────

/** 手动驱动的假计时器：注册的 handler 由测试显式触发。 */
function makeFakeTimers() {
  const pending: Array<{ handler: () => void; at: number }> = [];
  let now = 0;
  const timers = {
    setTimeout: (handler: () => void, timeoutMs: number) => {
      const handle = pending.length + 1000;
      pending.push({ handler, at: now + timeoutMs });
      return handle;
    },
    clearTimeout: (handle: number) => {
      const index = pending.findIndex((_, i) => i + 1000 === handle);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  return {
    timers,
    advance: (ms: number) => {
      now += ms;
      const due = pending.filter((entry) => entry.at <= now);
      for (const entry of due) {
        pending.splice(pending.indexOf(entry), 1);
        entry.handler();
      }
    },
    size: () => pending.length,
  };
}

describe("createStreamingBatcher", () => {
  it("将窗口内的多个 chunk 合并为一次更新", () => {
    const fake = makeFakeTimers();
    const updates: string[] = [];
    const batcher = createStreamingBatcher(
      (updater) => {
        updates.push(updater(""));
      },
      { timers: fake.timers }
    );

    batcher.push("你");
    batcher.push("好");
    batcher.push("，");
    expect(fake.size()).toBe(1); // 多次 push 只排队一个定时器
    expect(updates).toHaveLength(0);

    fake.advance(50);
    expect(updates).toEqual(["你好，"]);

    batcher.push("世界");
    batcher.cancel(); // cancel 清空未 flush 的内容
    fake.advance(50);
    expect(updates).toEqual(["你好，"]);
  });

  it("flush 立即输出且输出后不残留", () => {
    const updates: string[] = [];
    const fake = makeFakeTimers();
    const batcher = createStreamingBatcher(
      (updater) => {
        updates.push(updater("prev-"));
      },
      { timers: fake.timers }
    );

    batcher.push("abc");
    batcher.flush();
    expect(updates).toEqual(["prev-abc"]);

    batcher.flush(); // 空flush无副作用
    expect(updates).toHaveLength(1);

    batcher.push("x");
    fake.advance(50);
    expect(updates).toEqual(["prev-abc", "prev-x"]);
  });

  it("空 chunk 不触发定时器", () => {
    const fake = makeFakeTimers();
    const batcher = createStreamingBatcher(() => undefined, { timers: fake.timers });
    batcher.push("");
    expect(fake.size()).toBe(0);
  });
});

// ── 运行代次控制 ────────────────────────────────────────────

describe("createRunControl", () => {
  it("新运行使旧运行失效", () => {
    const control = createRunControl();
    const run1 = control.beginRun();
    expect(control.isRunCancelled(run1)).toBe(false);
    const run2 = control.beginRun();
    expect(control.isRunCancelled(run1)).toBe(true);
    expect(control.isRunCancelled(run2)).toBe(false);
  });

  it("requestStop 取消当前运行并拒绝后续同 id 运行", () => {
    const control = createRunControl();
    const run = control.beginRun();
    control.requestStop();
    expect(control.isRunCancelled(run)).toBe(true);
    // 下一次 beginRun 重置停止标记
    const next = control.beginRun();
    expect(control.isRunCancelled(next)).toBe(false);
  });
});

// ── 章节进度解析 ────────────────────────────────────────────

describe("extractSectionProgressFromMessage", () => {
  it("解析 '3 / 10' 形式的进度", () => {
    expect(extractSectionProgressFromMessage("正在撰写第 3 / 10 节")).toEqual({ current: 3, total: 10 });
    expect(extractSectionProgressFromMessage("7/7")).toEqual({ current: 7, total: 7 });
  });

  it("非法输入返回 null 并夹紧范围", () => {
    expect(extractSectionProgressFromMessage(undefined)).toBe(null);
    expect(extractSectionProgressFromMessage("没有进度信息")).toBe(null);
    expect(extractSectionProgressFromMessage("99 / 0")).toBe(null); // total<=0
    expect(extractSectionProgressFromMessage("15 / 10")).toEqual({ current: 10, total: 10 });
    expect(extractSectionProgressFromMessage("0 / 10")).toEqual({ current: 0, total: 10 }); // 负号不在捕获组内，夹紧到 0
  });
});

// ── 计划视图 ────────────────────────────────────────────────

const sampleOutline: ArticleOutline = {
  title: "测试文章",
  sections: [
    { title: "第一章", level: 2, keyPoints: [], estimatedParagraphs: 2 },
    { title: "第二章", level: 2, keyPoints: [], estimatedParagraphs: 2 },
  ],
} as unknown as ArticleOutline;

describe("toPlanMarkdownFromOutline", () => {
  it("渲染章节列表", () => {
    expect(toPlanMarkdownFromOutline(sampleOutline)).toBe("## 阶段计划\n1. 第一章\n2. 第二章");
  });
});

describe("withPlanProgressMeta", () => {
  const fixedHistory: never[] = [];

  it("保留 base 字段并附加 ETA 标签（注入 metrics 历史）", () => {
    const view = withPlanProgressMeta(
      {
        content: "计划内容",
        currentStage: 2,
        totalStages: 5,
        completedStages: [1],
        currentSectionTitle: "第二章",
      },
      "writing",
      { loadHistory: () => fixedHistory }
    );
    expect(view.content).toBe("计划内容");
    expect(view.currentStage).toBe(2);
    expect(view.totalStages).toBe(5);
    expect(view.currentSectionTitle).toBe("第二章");
    expect(typeof view.updatedAt).toBe("string");
  });

  it("无章节标题时从 ETA 结果回填", () => {
    const view = withPlanProgressMeta(
      {
        content: "",
        currentStage: 1,
        totalStages: 1,
        completedStages: [],
      },
      "planning",
      { loadHistory: () => fixedHistory }
    );
    expect(view).toHaveProperty("etaLabel");
  });
});

// ── 待应用事务句柄 ──────────────────────────────────────────

describe("appendPendingAgentTransaction", () => {
  it("空句柄创建新句柄", () => {
    const handle = appendPendingAgentTransaction(null, "tx-1", "group-1");
    expect(handle.transactionIds).toEqual(["tx-1"]);
    expect(handle.operationGroupId).toBe("group-1");
  });

  it("复用句柄就地追加并去重", () => {
    const existing = { transactionIds: ["tx-1"], operationGroupId: undefined };
    const handle = appendPendingAgentTransaction(existing, "tx-2", "group-9");
    expect(handle).toBe(existing); // 同一对象
    expect(handle.transactionIds).toEqual(["tx-1", "tx-2"]);
    expect(handle.operationGroupId).toBe("group-9");
    // 重复 id 不追加
    appendPendingAgentTransaction(handle, "tx-2");
    expect(handle.transactionIds).toEqual(["tx-1", "tx-2"]);
  });
});

// ── 会话消息互转 / 裁剪 ─────────────────────────────────────

describe("conversation message transforms", () => {
  const stored = [
    {
      id: "m1",
      type: "assistant" as const,
      content: "# 标题\n正文",
      timestamp: "2026-01-01T00:00:00.000Z",
      action: "polish",
    },
    {
      id: "m2",
      type: "user" as const,
      content: "帮我润色",
      timestamp: "2026-01-01T00:01:00.000Z",
    },
  ];

  it("normalize 填充 plainText 与 Date timestamp", () => {
    const messages = normalizeStoredConversationMessages(stored as never[]);
    expect(messages[0]!.timestamp).toBeInstanceOf(Date);
    expect(messages[0]!.plainText).toBeTruthy();
    expect(messages[0]!.action).toBe("polish");
    expect(messages[1]!.plainText).toBeUndefined(); // user 消息不生成 plainText
  });

  it("toStored 与 normalize 互逆（timestamp 回到 ISO 字符串）", () => {
    const messages = normalizeStoredConversationMessages(stored as never[]);
    const back = toStoredConversationMessages(messages);
    expect(back[0]!.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(back[1]!.id).toBe("m2");
  });

  it("pruneVisibleMessages 保留最新消息", () => {
    const messages: Message[] = Array.from({ length: MAX_VISIBLE_MESSAGES + 10 }, (_, i) => ({
      id: `m${i}`,
      type: "user" as const,
      content: `c${i}`,
      timestamp: new Date(2026, 0, 1, 0, 0, i),
    }));
    const pruned = pruneVisibleMessages(messages);
    expect(pruned).not.toBe(null);
    expect(pruned!.nextMessages).toHaveLength(MAX_VISIBLE_MESSAGES);
    expect(pruned!.nextMessages[0]!.id).toBe(`m10`);
    expect(pruned!.retainedIds.has("m9")).toBe(false);
    expect(pruned!.retainedIds.has("m10")).toBe(true);
  });

  it("未超限时返回 null", () => {
    const messages: Message[] = [
      { id: "a", type: "user", content: "x", timestamp: new Date() },
    ];
    expect(pruneVisibleMessages(messages)).toBe(null);
  });
});
