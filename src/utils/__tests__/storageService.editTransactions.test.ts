import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  loadEditTransactionRecord,
  loadEditTransactions,
  loadEditTransactionsByCreatedAt,
  loadEditTransactionsByOperationGroup,
  loadRollbackRecordsForTransaction,
  saveEditTransactionRecord,
} from "../storageService";
import type { EditTransaction } from "../editTransactionTypes";

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

function installStorageMocks() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: createStorageMock(),
  });
}

function restoreStorageMocks() {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
  if (originalSessionStorageDescriptor) {
    Object.defineProperty(globalThis, "sessionStorage", originalSessionStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
}

function transaction(overrides: Partial<EditTransaction>): EditTransaction {
  return {
    id: overrides.id || "tx_1",
    source: overrides.source || "agent_tool",
    operationGroupId: overrides.operationGroupId,
    operation: overrides.operation || {
      type: "insert_text",
      content: "content",
      contentFormat: "plain_text",
    },
    scope: overrides.scope || { kind: "cursor", location: "cursor" },
    status: overrides.status || "committed",
    createdAt: overrides.createdAt || "2026-05-21T00:00:00.000Z",
    committedAt: overrides.committedAt,
    rollbackOf: overrides.rollbackOf,
  };
}

describe("edit transaction storage queries", () => {
  beforeEach(() => {
    installStorageMocks();
  });

  afterEach(() => {
    restoreStorageMocks();
  });

  it("queries transactions by operation group in reverse commit order", async () => {
    await saveEditTransactionRecord(transaction({
      id: "tx_a",
      operationGroupId: "group_1",
      createdAt: "2026-05-21T00:00:00.000Z",
      committedAt: "2026-05-21T00:00:01.000Z",
    }));
    await saveEditTransactionRecord(transaction({
      id: "tx_b",
      operationGroupId: "group_1",
      createdAt: "2026-05-21T00:00:00.000Z",
      committedAt: "2026-05-21T00:00:03.000Z",
    }));
    await saveEditTransactionRecord(transaction({
      id: "tx_other",
      operationGroupId: "group_2",
    }));

    const group = await loadEditTransactionsByOperationGroup("group_1");

    expect(group.map((item) => item.id)).toEqual(["tx_b", "tx_a"]);
  });

  it("queries rollback records for an original transaction", async () => {
    await saveEditTransactionRecord(transaction({ id: "tx_original" }));
    await saveEditTransactionRecord(transaction({
      id: "tx_rollback",
      operation: { type: "apply_format", content: "rollback:tx_original", contentFormat: "plain_text" },
      rollbackOf: "tx_original",
    }));

    const rollbackRecords = await loadRollbackRecordsForTransaction("tx_original");

    expect(rollbackRecords).toHaveLength(1);
    expect(rollbackRecords[0].id).toBe("tx_rollback");
    expect((await loadEditTransactionRecord("tx_original"))?.id).toBe("tx_original");
  });

  it("filters transactions by createdAt range", async () => {
    await saveEditTransactionRecord(transaction({ id: "tx_before", createdAt: "2026-05-20T23:59:00.000Z" }));
    await saveEditTransactionRecord(transaction({ id: "tx_inside", createdAt: "2026-05-21T12:00:00.000Z" }));
    await saveEditTransactionRecord(transaction({ id: "tx_after", createdAt: "2026-05-22T00:01:00.000Z" }));

    const filtered = await loadEditTransactionsByCreatedAt(
      "2026-05-21T00:00:00.000Z",
      "2026-05-21T23:59:59.000Z"
    );

    expect(filtered.map((item) => item.id)).toEqual(["tx_inside"]);
    expect(await loadEditTransactions()).toHaveLength(3);
  });
});
