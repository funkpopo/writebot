/* global Office */

/**
 * 功能区命令处理
 */

Office.onReady(() => {
  // Office 已准备就绪
});

/**
 * 显示任务窗格
 */
function showTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.showAsTaskpane();
  event.completed();
}

/**
 * 隐藏任务窗格
 */
function hideTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.hide();
  event.completed();
}

/**
 * 切换任务窗格显示状态
 */
function toggleTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.showAsTaskpane();
  event.completed();
}

// 注册命令函数到全局作用域
(globalThis as Record<string, unknown>).showTaskpane = showTaskpane;
(globalThis as Record<string, unknown>).hideTaskpane = hideTaskpane;
(globalThis as Record<string, unknown>).toggleTaskpane = toggleTaskpane;
