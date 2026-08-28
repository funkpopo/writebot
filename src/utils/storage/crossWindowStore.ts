/**
 * 跨窗口通信存储 - 功能区按钮请求
 * 优先使用 OfficeRuntime.storage（跨 taskpane/commands 共享），
 * 不可用时回退 localStorage 并触发 storage 事件。
 */

import type { RibbonCommandRequest } from "./settingsStore";

const RIBBON_COMMAND_REQUEST_KEY = "writebot_ribbon_command_request";

/**
 * 功能区按钮请求（跨 taskpane/commands 共享）
 */

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
