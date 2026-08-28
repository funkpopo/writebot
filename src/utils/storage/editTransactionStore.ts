/**
 * 编辑事务台账存储 (使用 sessionStorage，关闭 Word 后自动清除)
 */

import type { EditTransaction } from "../editTransactionTypes";

const EDIT_TRANSACTION_LEDGER_KEY = "writebot_edit_transactions";
export const EDIT_TRANSACTION_LEDGER_CHANGED_EVENT = "writebot_edit_transactions_changed";

export type StoredEditTransactionRecord = EditTransaction;

function normalizeEditTransactionRecord(value: unknown): StoredEditTransactionRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.source !== "string"
    || typeof record.status !== "string"
    || typeof record.createdAt !== "string"
    || !record.operation
    || typeof record.operation !== "object"
    || !record.scope
    || typeof record.scope !== "object"
  ) {
    return null;
  }
  return record as unknown as StoredEditTransactionRecord;
}

function loadEditTransactionLedgerMap(): Map<string, StoredEditTransactionRecord> {
  try {
    const raw = sessionStorage.getItem(EDIT_TRANSACTION_LEDGER_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown[];
    const records = Array.isArray(parsed) ? parsed : [];
    const ledger = new Map<string, StoredEditTransactionRecord>();
    for (const item of records) {
      const normalized = normalizeEditTransactionRecord(item);
      if (normalized) {
        ledger.set(normalized.id, normalized);
      }
    }
    return ledger;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `读取编辑事务持久化失败：${error.message}`
        : "读取编辑事务持久化失败"
    );
  }
}

function persistEditTransactionLedgerMap(ledger: Map<string, StoredEditTransactionRecord>): void {
  try {
    sessionStorage.setItem(
      EDIT_TRANSACTION_LEDGER_KEY,
      JSON.stringify(Array.from(ledger.values()))
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `保存编辑事务持久化失败：${error.message}`
        : "保存编辑事务持久化失败"
    );
  }
}

export async function saveEditTransactionRecord(record: StoredEditTransactionRecord): Promise<void> {
  const normalized = normalizeEditTransactionRecord(record);
  if (!normalized) {
    throw new Error("保存编辑事务失败：记录结构不合法");
  }
  const ledger = loadEditTransactionLedgerMap();
  ledger.set(normalized.id, normalized);
  persistEditTransactionLedgerMap(ledger);
  try {
    window.dispatchEvent(new CustomEvent(EDIT_TRANSACTION_LEDGER_CHANGED_EVENT, {
      detail: { transactionId: normalized.id, count: ledger.size },
    }));
  } catch {
    // ignore non-browser/test environments
  }
}

export async function loadEditTransactions(): Promise<StoredEditTransactionRecord[]> {
  return Array.from(loadEditTransactionLedgerMap().values())
    .sort((left, right) => {
      const l = Date.parse(left.createdAt);
      const r = Date.parse(right.createdAt);
      return Number.isFinite(r - l) ? r - l : 0;
    });
}

export async function loadEditTransactionRecord(id: string): Promise<StoredEditTransactionRecord | null> {
  if (!id.trim()) return null;
  const ledger = loadEditTransactionLedgerMap();
  return ledger.get(id) || null;
}

export async function loadEditTransactionsByOperationGroup(
  operationGroupId: string
): Promise<StoredEditTransactionRecord[]> {
  const groupId = operationGroupId.trim();
  if (!groupId) return [];
  return (await loadEditTransactions())
    .filter((record) => record.operationGroupId === groupId)
    .sort((left, right) => {
      const l = Date.parse(left.committedAt || left.createdAt);
      const r = Date.parse(right.committedAt || right.createdAt);
      return Number.isFinite(r - l) ? r - l : 0;
    });
}

export async function loadEditTransactionsByCreatedAt(
  fromIso?: string,
  toIso?: string
): Promise<StoredEditTransactionRecord[]> {
  const from = fromIso ? Date.parse(fromIso) : Number.NEGATIVE_INFINITY;
  const to = toIso ? Date.parse(toIso) : Number.POSITIVE_INFINITY;
  return (await loadEditTransactions()).filter((record) => {
    const createdAt = Date.parse(record.createdAt);
    if (!Number.isFinite(createdAt)) return false;
    return createdAt >= from && createdAt <= to;
  });
}

export async function loadRollbackRecordsForTransaction(
  transactionId: string
): Promise<StoredEditTransactionRecord[]> {
  const id = transactionId.trim();
  if (!id) return [];
  return (await loadEditTransactions()).filter((record) => record.rollbackOf === id);
}
