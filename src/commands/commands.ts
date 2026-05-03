/* global Office */

function showTaskpane(event: Office.AddinCommands.Event): void {
  Office.addin.showAsTaskpane();
  event.completed();
}

(globalThis as Record<string, unknown>).showTaskpane = showTaskpane;
Office.actions.associate("showTaskpane", showTaskpane);
