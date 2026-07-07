import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ASSISTANT_MODULES_UPDATED_EVENT,
  createCustomAssistantModule,
  getAllAssistantModules,
  getDeletedAssistantModules,
  resetAssistantModules,
  restoreDefaultAssistantModules,
  restoreLastDeletedAssistantModule,
  saveAssistantModules,
  stashDeletedAssistantModule,
} from "../assistantModuleService";
import {
  getPrompt,
  getStoredPromptOverride,
  resetPrompt,
  savePrompt,
} from "../promptService";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const testStorage = new MemoryStorage();

beforeEach(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: testStorage,
  });
  testStorage.clear();
  await resetAssistantModules();
});

afterAll(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("assistantModuleService", () => {
  it("falls back to the module default prompt when a custom module has no override", async () => {
    const modules = getAllAssistantModules();
    const customModule = createCustomAssistantModule(modules, "style");

    await saveAssistantModules([...modules, customModule]);

    expect(getStoredPromptOverride(customModule.promptKey as string)).toBeUndefined();
    expect(getPrompt(customModule.promptKey as string)).toBe(customModule.defaultPrompt);
  });

  it("persists custom module edits without changing its prompt key", async () => {
    const modules = getAllAssistantModules();
    const customModule = createCustomAssistantModule(modules, "basic");
    const promptKey = customModule.promptKey as string;

    await saveAssistantModules([...modules, customModule]);
    await saveAssistantModules([
      ...modules,
      {
        ...customModule,
        label: "合同摘要",
        description: "提取合同关键条款",
        inputPlaceholder: "粘贴合同正文...",
      },
    ]);

    const saved = getAllAssistantModules().find((module) => module.id === customModule.id);
    expect(saved?.label).toBe("合同摘要");
    expect(saved?.description).toBe("提取合同关键条款");
    expect(saved?.inputPlaceholder).toBe("粘贴合同正文...");
    expect(saved?.promptKey).toBe(promptKey);
    expect(getPrompt(promptKey)).toBe(customModule.defaultPrompt);
  });

  it("notifies the current taskpane when modules are saved", async () => {
    const originalWindow = (globalThis as { window?: Window }).window;
    let notifications = 0;
    const target = new EventTarget();
    const testWindow = {
      dispatchEvent: (event: Event) => target.dispatchEvent(event),
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
        target.addEventListener(type, listener),
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
        target.removeEventListener(type, listener),
    } as unknown as Window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: testWindow,
    });

    try {
      testWindow.addEventListener(ASSISTANT_MODULES_UPDATED_EVENT, () => {
        notifications += 1;
      });

      await saveAssistantModules(getAllAssistantModules());

      expect(notifications).toBe(1);
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          writable: true,
          value: originalWindow,
        });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("restores the last deleted module together with its prompt override", async () => {
    const modules = getAllAssistantModules();
    const customModule = createCustomAssistantModule(modules, "basic");
    const promptKey = customModule.promptKey as string;
    const promptOverride = "你是一个用于恢复测试的自定义模块。";

    await saveAssistantModules([...modules, customModule]);
    await savePrompt(promptKey, promptOverride);

    await stashDeletedAssistantModule(customModule, getStoredPromptOverride(promptKey));
    await resetPrompt(promptKey);
    await saveAssistantModules(modules);

    const restored = await restoreLastDeletedAssistantModule();
    expect(restored?.module.id).toBe(customModule.id);

    if (restored?.module.promptKey) {
      if (restored.promptOverride) {
        await savePrompt(restored.module.promptKey, restored.promptOverride);
      } else {
        await resetPrompt(restored.module.promptKey);
      }
    }

    expect(getAllAssistantModules().some((module) => module.id === customModule.id)).toBe(true);
    expect(getPrompt(promptKey)).toBe(promptOverride);
    expect(getDeletedAssistantModules()).toHaveLength(0);
  });

  it("restores builtin defaults without affecting custom modules", async () => {
    const initialModules = getAllAssistantModules();
    const customModule = createCustomAssistantModule(initialModules, "basic");
    const remainingModules = initialModules
      .filter((module) => module.id !== "agent")
      .concat(customModule);
    const deletedBuiltin = initialModules.find((module) => module.id === "agent");

    await saveAssistantModules(remainingModules);
    if (deletedBuiltin) {
      await stashDeletedAssistantModule(deletedBuiltin);
    }
    await stashDeletedAssistantModule(customModule);

    const restoredModules = await restoreDefaultAssistantModules();
    const restoredIds = restoredModules.map((module) => module.id);

    expect(restoredIds).toEqual([
      "agent",
      "polish",
      "translate",
      "grammar",
      "summarize",
      "continue",
      "generate",
      customModule.id,
    ]);
    expect(getAllAssistantModules().map((module) => module.id)).toEqual([
      "agent",
      "polish",
      "translate",
      "grammar",
      "summarize",
      "continue",
      "generate",
      customModule.id,
    ]);
    expect(getDeletedAssistantModules().map((item) => item.module.id)).toEqual([customModule.id]);
  });

  it("fully resets modules and clears deleted history", async () => {
    const initialModules = getAllAssistantModules();
    const customModule = createCustomAssistantModule(initialModules, "basic");
    await saveAssistantModules([...initialModules, customModule]);
    await stashDeletedAssistantModule(customModule);

    const restoredModules = await resetAssistantModules();

    expect(restoredModules.map((module) => module.id)).toEqual([
      "agent",
      "polish",
      "translate",
      "grammar",
      "summarize",
      "continue",
      "generate",
    ]);
    expect(getDeletedAssistantModules()).toHaveLength(0);
  });
});
