/**
 * Shared continuation helpers for tool-call streaming with truncation recovery.
 */

import type { ToolCallRequest } from "../../types/tools";
import { safeParseArguments } from "./helpers";

export const MAX_CONTINUATION_ROUNDS = 3;

export interface OrderedOpenAIToolCallState {
  id?: string;
  name?: string;
  arguments: string;
  order?: number;
}

export interface OrderedAnthropicToolCallState {
  id?: string;
  name?: string;
  inputJson: string;
  order?: number;
}

export interface StreamResult {
  content: string;
  toolCallMap: Record<number, OrderedOpenAIToolCallState>;
  finishReason: string | null;
}

export interface AnthropicStreamResult {
  content: string;
  toolCallMap: Record<number, OrderedAnthropicToolCallState>;
  finishReason: string | null;
}

export function getOrderedToolCallEntries<T>(toolCallMap: Record<number, T>): T[] {
  return Object.entries(toolCallMap)
    .map(([index, entry]) => ({ index: Number(index), entry }))
    .sort((a, b) => a.index - b.index)
    .map(({ entry }) => entry);
}

export function sortToolEntriesByOrder<T extends { order?: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const left = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
    const right = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

export function assignMissingToolCallOrder<T extends { order?: number }>(
  entries: T[],
  nextOrder: number
): number {
  for (const entry of entries) {
    if (typeof entry.order !== "number") {
      entry.order = nextOrder;
      nextOrder += 1;
    }
  }
  return nextOrder;
}

export function isCompleteToolJson(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

export function partitionOpenAIToolCallMapByCompleteness(
  toolCallMap: Record<number, OrderedOpenAIToolCallState>
): {
  completeEntries: OrderedOpenAIToolCallState[];
  incompleteEntries: OrderedOpenAIToolCallState[];
} {
  const orderedEntries = sortToolEntriesByOrder(getOrderedToolCallEntries(toolCallMap));
  const completeEntries: OrderedOpenAIToolCallState[] = [];
  const incompleteEntries: OrderedOpenAIToolCallState[] = [];

  for (const entry of orderedEntries) {
    if (isCompleteToolJson(entry.arguments)) {
      completeEntries.push(entry);
    } else {
      incompleteEntries.push(entry);
    }
  }

  return { completeEntries, incompleteEntries };
}

export function partitionAnthropicToolCallMapByCompleteness(
  toolCallMap: Record<number, OrderedAnthropicToolCallState>
): {
  completeEntries: OrderedAnthropicToolCallState[];
  incompleteEntries: OrderedAnthropicToolCallState[];
} {
  const orderedEntries = sortToolEntriesByOrder(getOrderedToolCallEntries(toolCallMap));
  const completeEntries: OrderedAnthropicToolCallState[] = [];
  const incompleteEntries: OrderedAnthropicToolCallState[] = [];

  for (const entry of orderedEntries) {
    if (isCompleteToolJson(entry.inputJson)) {
      completeEntries.push(entry);
    } else {
      incompleteEntries.push(entry);
    }
  }

  return { completeEntries, incompleteEntries };
}

export function buildOpenAIToolCallMapFromEntries(
  entries: OrderedOpenAIToolCallState[]
): Record<number, OrderedOpenAIToolCallState> {
  const nextMap: Record<number, OrderedOpenAIToolCallState> = {};
  sortToolEntriesByOrder(entries).forEach((entry, index) => {
    nextMap[index] = { ...entry };
  });
  return nextMap;
}

export function buildAnthropicToolCallMapFromEntries(
  entries: OrderedAnthropicToolCallState[]
): Record<number, OrderedAnthropicToolCallState> {
  const nextMap: Record<number, OrderedAnthropicToolCallState> = {};
  sortToolEntriesByOrder(entries).forEach((entry, index) => {
    nextMap[index] = { ...entry };
  });
  return nextMap;
}

export function toOpenAIToolCalls(entries: OrderedOpenAIToolCallState[]): ToolCallRequest[] {
  return sortToolEntriesByOrder(entries).map((entry, index) => ({
    id: entry.id || `${entry.name || "tool"}_${entry.order ?? index}`,
    name: entry.name || "unknown",
    arguments: safeParseArguments(entry.arguments),
  }));
}

export function toAnthropicToolCalls(entries: OrderedAnthropicToolCallState[]): ToolCallRequest[] {
  return sortToolEntriesByOrder(entries).map((entry, index) => ({
    id: entry.id || `${entry.name || "tool"}_${entry.order ?? index}`,
    name: entry.name || "unknown",
    arguments: safeParseArguments(entry.inputJson),
  }));
}

export function findToolIndexById<T extends { id?: string }>(
  toolCallMap: Record<number, T>,
  targetId: string
): number | null {
  for (const [index, entry] of Object.entries(toolCallMap)) {
    if (entry.id === targetId) {
      return Number(index);
    }
  }
  return null;
}

export function reserveNextToolIndex<T>(toolCallMap: Record<number, T>): number {
  const used = Object.keys(toolCallMap).map((index) => Number(index));
  if (used.length === 0) return 0;
  return Math.max(...used) + 1;
}

export function resolveIncomingToolIndex<T extends { id?: string }>(
  toolCallMap: Record<number, T>,
  incomingIndex: number | undefined,
  incomingId?: string
): number {
  if (incomingId) {
    const matched = findToolIndexById(toolCallMap, incomingId);
    if (matched !== null) return matched;
  }

  const index = incomingIndex ?? 0;
  const existing = toolCallMap[index];
  if (!existing) {
    return index;
  }

  if (!incomingId || !existing.id || existing.id === incomingId) {
    return index;
  }

  return reserveNextToolIndex(toolCallMap);
}

export const __toolCallContinuationInternals = {
  assignMissingToolCallOrder,
  buildOpenAIToolCallMapFromEntries,
  isCompleteToolJson,
  partitionOpenAIToolCallMapByCompleteness,
  resolveIncomingToolIndex,
  toOpenAIToolCalls,
};
