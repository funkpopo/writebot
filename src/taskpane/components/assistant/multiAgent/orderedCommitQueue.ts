import { AgentHarnessError } from "./agentHarness";

export type OrderedCommitSlotState<T> =
  | { kind: "empty" }
  | { kind: "ready"; value: T | null }
  | { kind: "error"; error: unknown };

export interface OrderedCommitProgress {
  drafted: number;
  written: number;
  total: number;
  /** Next section index the commit loop will process (0-based). */
  nextCommitIndex: number;
}

export interface ParallelProduceOrderedCommitParams<T> {
  total: number;
  concurrency: number;
  isCancelled: () => boolean;
  /**
   * Produce item for `index`. Return `null` to skip commit work for that index
   * (e.g. already completed sections).
   */
  produce: (index: number) => Promise<T | null>;
  /**
   * Commit items in ascending index order. Invoked only after `0..index-1`
   * have committed successfully. Runs serially.
   */
  commit: (index: number, value: T | null) => Promise<void>;
  /**
   * Called after a produce completes. `nextCommitIndex` reflects how far the
   * ordered commit head has advanced (useful for "waiting for prior" UI).
   */
  onProduced?: (index: number, value: T | null, progress: OrderedCommitProgress) => void;
  /** Called immediately before starting a commit (after cancel check). */
  onBeforeCommit?: (index: number, value: T | null, progress: OrderedCommitProgress) => void;
  /** Called after a commit finishes successfully. */
  onAfterCommit?: (index: number, value: T | null, progress: OrderedCommitProgress) => void;
  /** Message used when cancelling unstarted produce work. */
  cancelMessage?: string;
}

/**
 * Produce items with limited parallelism; commit them in strict index order as
 * soon as each head item is ready (do not wait for the entire batch).
 *
 * Cancel semantics:
 * - Stop claiming new produce work once cancelled
 * - Finish an in-flight `commit` safely, then refuse subsequent commits
 * - Unstarted produce slots fail with `cancelled` so the commit loop never hangs
 */
export async function runParallelProduceOrderedCommit<T>(
  params: ParallelProduceOrderedCommitParams<T>,
): Promise<void> {
  const total = Math.max(0, Math.floor(params.total));
  if (total === 0) return;

  const concurrency = Math.max(1, Math.min(total, Math.floor(params.concurrency) || 1));
  const cancelMessage = params.cancelMessage || "有序提交队列已取消";

  const slots: Array<OrderedCommitSlotState<T>> = Array.from({ length: total }, () => ({ kind: "empty" }));
  const waiters: Array<Array<() => void>> = Array.from({ length: total }, () => []);

  let nextProduceIndex = 0;
  let nextCommitIndex = 0;
  let drafted = 0;
  let written = 0;
  let produceFatal: unknown = null;

  const progress = (): OrderedCommitProgress => ({
    drafted,
    written,
    total,
    nextCommitIndex,
  });

  const notify = (index: number): void => {
    const pending = waiters[index];
    waiters[index] = [];
    for (const resolve of pending) resolve();
  };

  const setReady = (index: number, value: T | null): void => {
    if (slots[index].kind !== "empty") return;
    slots[index] = { kind: "ready", value };
    notify(index);
  };

  const setError = (index: number, error: unknown): void => {
    if (slots[index].kind !== "empty") return;
    slots[index] = { kind: "error", error };
    notify(index);
  };

  const failRemainingEmpty = (error: unknown): void => {
    for (let i = 0; i < total; i += 1) {
      setError(i, error);
    }
  };

  const waitUntilSettled = async (index: number): Promise<void> => {
    while (slots[index].kind === "empty") {
      await new Promise<void>((resolve) => {
        waiters[index].push(resolve);
      });
    }
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      if (produceFatal) return;
      if (params.isCancelled()) return;

      const index = nextProduceIndex;
      nextProduceIndex += 1;
      if (index >= total) return;

      try {
        const value = await params.produce(index);
        if (slots[index].kind !== "empty") {
          // Slot may already be failed by a sibling fatal/cancel race.
          continue;
        }
        drafted += 1;
        setReady(index, value);
        params.onProduced?.(index, value, progress());
      } catch (error) {
        produceFatal = error;
        setError(index, error);
        failRemainingEmpty(error);
        return;
      }
    }
  });

  const workersDone = Promise.all(workers).then(() => {
    if (produceFatal) {
      failRemainingEmpty(produceFatal);
      return;
    }
    if (params.isCancelled()) {
      const cancelled = new AgentHarnessError("cancelled", cancelMessage);
      produceFatal = cancelled;
      failRemainingEmpty(cancelled);
    }
  });

  try {
    for (let index = 0; index < total; index += 1) {
      await waitUntilSettled(index);
      const slot = slots[index];
      if (slot.kind === "error") {
        throw slot.error;
      }
      if (slot.kind !== "ready") {
        throw new AgentHarnessError(
          "state_contract_violation",
          `有序提交队列槽位未就绪：${index}`,
          { details: { index, slot } },
        );
      }

      // Do not start a new commit after cancel. An in-flight commit is allowed
      // to finish because this check runs only before starting commit work.
      if (params.isCancelled()) {
        throw new AgentHarnessError("cancelled", cancelMessage);
      }

      params.onBeforeCommit?.(index, slot.value, progress());
      // Once commit starts, allow it to finish even if cancel flips mid-write.
      await params.commit(index, slot.value);

      written += 1;
      nextCommitIndex = index + 1;
      params.onAfterCommit?.(index, slot.value, progress());
    }
  } catch (error) {
    // Stop unstarted produce work and unblock any waiters on empty slots.
    if (produceFatal == null) {
      produceFatal = error;
    }
    failRemainingEmpty(produceFatal);
    throw error;
  } finally {
    if (produceFatal == null && params.isCancelled()) {
      const cancelled = new AgentHarnessError("cancelled", cancelMessage);
      produceFatal = cancelled;
      failRemainingEmpty(cancelled);
    } else if (produceFatal != null) {
      failRemainingEmpty(produceFatal);
    }
    await workersDone;
  }
}
