import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import { runParallelProduceOrderedCommit } from "../orderedCommitQueue";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runParallelProduceOrderedCommit", () => {
  it("writes in index order even when later drafts finish first", async () => {
    const produceOrder: number[] = [];
    const commitOrder: number[] = [];
    const produceStartedAt = new Map<number, number>();
    const commitStartedAt = new Map<number, number>();
    let now = 0;

    await runParallelProduceOrderedCommit<string>({
      total: 3,
      concurrency: 3,
      isCancelled: () => false,
      produce: async (index) => {
        produceOrder.push(index);
        produceStartedAt.set(index, now++);
        // Reverse latency: section 2 finishes first, then 1, then 0.
        await delay(30 - index * 10);
        return `draft-${index}`;
      },
      commit: async (index, value) => {
        commitStartedAt.set(index, now++);
        commitOrder.push(index);
        expect(value).toBe(`draft-${index}`);
        await delay(5);
      },
    });

    expect(commitOrder).toEqual([0, 1, 2]);
    // Drafts can complete out of order.
    expect(produceOrder).toEqual([0, 1, 2]);
    // Commit of 0 may start before later drafts finish, but commits stay ordered.
    expect(commitStartedAt.get(0)!).toBeLessThan(commitStartedAt.get(1)!);
    expect(commitStartedAt.get(1)!).toBeLessThan(commitStartedAt.get(2)!);
    // Section 2 draft can finish before section 0 is committed.
    expect(produceStartedAt.get(2)!).toBeLessThan(commitStartedAt.get(0)!);
  });

  it("starts commit of section 0 before later drafts complete", async () => {
    let section0Committed = false;
    let section2DraftDoneAfterSection0Commit = false;
    let resolveSection0Draft!: () => void;
    const section0DraftGate = new Promise<void>((resolve) => {
      resolveSection0Draft = resolve;
    });

    const run = runParallelProduceOrderedCommit<string>({
      total: 3,
      concurrency: 3,
      isCancelled: () => false,
      produce: async (index) => {
        if (index === 0) {
          await section0DraftGate;
          return "d0";
        }
        if (index === 2) {
          // Wait until section 0 has been committed to prove overlap.
          for (let i = 0; i < 50 && !section0Committed; i += 1) {
            await delay(5);
          }
          section2DraftDoneAfterSection0Commit = section0Committed;
          return "d2";
        }
        return `d${index}`;
      },
      commit: async (index) => {
        if (index === 0) {
          section0Committed = true;
        }
        await delay(10);
      },
    });

    // Let workers claim 0/1/2, then release section 0 draft.
    await delay(20);
    resolveSection0Draft();
    await run;

    expect(section0Committed).toBe(true);
    expect(section2DraftDoneAfterSection0Commit).toBe(true);
  });

  it("stops unstarted produce work on cancel and does not commit after cancel", async () => {
    let cancelled = false;
    const produceStarted: number[] = [];
    const commitStarted: number[] = [];
    let resolveSlowDraft!: () => void;
    const slowDraft = new Promise<void>((resolve) => {
      resolveSlowDraft = resolve;
    });

    const run = runParallelProduceOrderedCommit<string>({
      total: 4,
      concurrency: 1,
      isCancelled: () => cancelled,
      cancelMessage: "test cancel",
      produce: async (index) => {
        produceStarted.push(index);
        if (index === 0) {
          await slowDraft;
          return "d0";
        }
        return `d${index}`;
      },
      commit: async (index) => {
        commitStarted.push(index);
        await delay(5);
      },
    });

    await delay(15);
    // Cancel while section 0 is still drafting (only one produce claimed so far).
    cancelled = true;
    resolveSlowDraft();

    let caught: unknown;
    try {
      await run;
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentHarnessError);
    expect((caught as AgentHarnessError).code).toBe("cancelled");
    // With concurrency 1, only index 0 should have started produce before cancel.
    expect(produceStarted).toEqual([0]);
    // Draft 0 may complete after cancel; commit must not start once cancelled.
    expect(commitStarted).toEqual([]);
  });

  it("finishes an in-flight commit after cancel, then refuses further commits", async () => {
    let cancelled = false;
    const commitStarted: number[] = [];
    const commitFinished: number[] = [];
    let resolveCommit0!: () => void;
    const commit0Gate = new Promise<void>((resolve) => {
      resolveCommit0 = resolve;
    });

    const run = runParallelProduceOrderedCommit<string>({
      total: 3,
      concurrency: 3,
      isCancelled: () => cancelled,
      cancelMessage: "test cancel mid-write",
      produce: async (index) => `d${index}`,
      commit: async (index) => {
        commitStarted.push(index);
        if (index === 0) {
          // Cancel while commit 0 is in progress.
          cancelled = true;
          await commit0Gate;
          commitFinished.push(index);
          return;
        }
        commitFinished.push(index);
      },
    });

    await delay(20);
    expect(commitStarted).toContain(0);
    resolveCommit0();

    let caught: unknown;
    try {
      await run;
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentHarnessError);
    expect((caught as AgentHarnessError).code).toBe("cancelled");
    expect(commitFinished).toEqual([0]);
    expect(commitStarted).toEqual([0]);
  });

  it("skips null produce values while preserving commit order", async () => {
    const commits: Array<{ index: number; value: string | null }> = [];

    await runParallelProduceOrderedCommit<string>({
      total: 3,
      concurrency: 2,
      isCancelled: () => false,
      produce: async (index) => (index === 1 ? null : `d${index}`),
      commit: async (index, value) => {
        commits.push({ index, value });
      },
    });

    expect(commits).toEqual([
      { index: 0, value: "d0" },
      { index: 1, value: null },
      { index: 2, value: "d2" },
    ]);
  });

  it("propagates produce errors and does not hang waiting on later slots", async () => {
    const commits: number[] = [];

    let caught: unknown;
    try {
      await runParallelProduceOrderedCommit<string>({
        total: 3,
        concurrency: 2,
        isCancelled: () => false,
        produce: async (index) => {
          if (index === 1) {
            throw new Error("draft boom");
          }
          await delay(30);
          return `d${index}`;
        },
        commit: async (index) => {
          commits.push(index);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("draft boom");
    // Depending on timing, 0 may or may not commit before index 1 fails.
    expect(commits.every((index) => index < 1 || index === 0)).toBe(true);
    expect(commits.includes(2)).toBe(false);
  });

  it("emits waiting-prior progress when later drafts finish first", async () => {
    const events: string[] = [];
    let resolve0!: () => void;
    const gate0 = new Promise<void>((resolve) => {
      resolve0 = resolve;
    });

    const run = runParallelProduceOrderedCommit<string>({
      total: 2,
      concurrency: 2,
      isCancelled: () => false,
      produce: async (index) => {
        if (index === 0) {
          await gate0;
          return "d0";
        }
        return "d1";
      },
      onProduced: (index, _value, progress) => {
        if (index > progress.nextCommitIndex) {
          events.push(`wait-prior:${index}:written=${progress.written}`);
        } else {
          events.push(`drafted:${index}`);
        }
      },
      commit: async (index) => {
        events.push(`commit:${index}`);
      },
      onAfterCommit: (index, _value, progress) => {
        events.push(`written:${progress.written}`);
        void index;
      },
    });

    await delay(20);
    // Section 1 should already be produced while 0 is still gated.
    expect(events.some((event) => event.startsWith("wait-prior:1"))).toBe(true);
    resolve0();
    await run;

    expect(events).toContain("commit:0");
    expect(events).toContain("commit:1");
    expect(events.indexOf("commit:0")).toBeLessThan(events.indexOf("commit:1"));
  });
});
