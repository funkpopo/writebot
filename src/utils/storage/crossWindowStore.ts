/**
 * 跨窗口通信存储 - 右键菜单操作结果 / 功能区按钮请求
 * 优先使用 OfficeRuntime.storage（跨 taskpane/commands 共享），
 * 不可用时回退 localStorage 并触发 storage 事件。
 */

import type { RibbonCommandRequest } from "./settingsStore";

export interface ContextMenuResult {
  id: string;
  originalText: string;
  resultText: string;
  thinking?: string;
  action: string;
  timestamp: string;
}

const CONTEXT_MENU_RESULT_KEY = "writebot_context_menu_result";
const RIBBON_COMMAND_REQUEST_KEY = "writebot_ribbon_command_request";

/**
 * 保存右键菜单操作结果（用于跨窗口通信）
 */
export async function saveContextMenuResult(result: ContextMenuResult): Promise<void> {
  try {
    const payload = JSON.stringify(result);
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      await OfficeRuntime.storage.setItem(CONTEXT_MENU_RESULT_KEY, payload);
    } else {
      localStorage.setItem(CONTEXT_MENU_RESULT_KEY, payload);
      // 触发 storage 事件以通知其他窗口
      window.dispatchEvent(new StorageEvent("storage", {
        key: CONTEXT_MENU_RESULT_KEY,
        newValue: payload,
      }));
    }
  } catch (e) {
    console.error("保存右键菜单结果失败:", e);
  }
}

/**
 * 获取并清除右键菜单操作结果
 */
export async function getAndClearContextMenuResult(): Promise<ContextMenuResult | null> {
  try {
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      const stored = await OfficeRuntime.storage.getItem(CONTEXT_MENU_RESULT_KEY);
      if (stored) {
        await OfficeRuntime.storage.removeItem(CONTEXT_MENU_RESULT_KEY);
        return JSON.parse(stored);
      }
      return null;
    }

    const stored = localStorage.getItem(CONTEXT_MENU_RESULT_KEY);
    if (stored) {
      localStorage.removeItem(CONTEXT_MENU_RESULT_KEY);
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("获取右键菜单结果失败:", e);
  }
  return null;
}

/**
 * 获取右键菜单结果存储键名（用于事件监听）
 */
export function getContextMenuResultKey(): string {
  return CONTEXT_MENU_RESULT_KEY;
}

export async function saveRibbonCommandRequest(request: RibbonCommandRequest): Promise<void> {
  try {
    const payload = JSON.stringify(request);
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      await OfficeRuntime.storage.setItem(RIBBON_COMMAND_REQUEST_KEY, payload);
    } else {
      localStorage.setItem(RIBBON_COMMAND_REQUEST_KEY, payload);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: RIBBON_COMMAND_REQUEST_KEY,
          newValue: payload,
        })
      );
    }
  } catch (e) {
    console.error("保存功能区按钮请求失败:", e);
  }
}

export async function getAndClearRibbonCommandRequest(): Promise<RibbonCommandRequest | null> {
  try {
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      const stored = await OfficeRuntime.storage.getItem(RIBBON_COMMAND_REQUEST_KEY);
      if (stored) {
        await OfficeRuntime.storage.removeItem(RIBBON_COMMAND_REQUEST_KEY);
        return JSON.parse(stored);
      }
      return null;
    }

    const stored = localStorage.getItem(RIBBON_COMMAND_REQUEST_KEY);
    if (stored) {
      localStorage.removeItem(RIBBON_COMMAND_REQUEST_KEY);
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("获取功能区按钮请求失败:", e);
  }
  return null;
}

export function getRibbonCommandRequestKey(): string {
  return RIBBON_COMMAND_REQUEST_KEY;
}
