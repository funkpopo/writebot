/* global Word */

import { TableData } from "./types";

function applyTableGridLook(table: Word.Table): void {
  // 1) Try built-in style (may be unavailable on some hosts / API sets).
  // 2) Fallback to style name.
  // 3) Always force borders as a final safety net so the user "sees a table".
  try {
    table.styleBuiltIn = Word.BuiltInStyleName.tableGrid;
  } catch {
    try {
      table.style = "Table Grid";
    } catch {
      // Ignore style set failures. We'll still apply borders below.
      console.warn("无法应用 Table Grid 样式");
    }
  }

  // Ensure borders are visible even if the style couldn't be applied (locale differences, missing styles, etc).
  // WordApi 1.3 supports table borders.
  try {
    const border = table.getBorder("All");
    border.type = Word.BorderType.single;
    border.color = "#D0D0D0";
    border.width = 0.75;
  } catch (e) {
    console.warn("无法设置表格边框:", e);
  }
}

/**
 * Insert a Word table from a 2D array of cell values.
 * This is used for "Convert Text to Table"-like scenarios (e.g. pasted table-range text),
 * where there is no special header row semantics.
 */
export async function insertTableFromValues(values: string[][]): Promise<void> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("表格数据无效：没有任何行");
  }

  const rowCount = values.length;
  const columnCount = Math.max(0, ...values.map((row) => (Array.isArray(row) ? row.length : 0)));

  if (columnCount === 0) {
    throw new Error("表格数据无效：列数为0");
  }

  const normalizedValues: string[][] = values.map((row) => {
    const safeRow = Array.isArray(row) ? row : [];
    const cells = safeRow.map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
    while (cells.length < columnCount) cells.push("");
    return cells.slice(0, columnCount);
  });

  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const table = selection.insertTable(rowCount, columnCount, Word.InsertLocation.after, normalizedValues);

    table.load("rows");
    await context.sync();

    applyTableGridLook(table);
    await context.sync();
  });
}

/**
 * 在当前选区位置插入 Word 表格
 * 使用 Table Grid 样式
 */
export async function insertTable(tableData: TableData): Promise<void> {
  const { headers, rows } = tableData;
  const rowCount = rows.length + 1; // +1 for header row
  const columnCount = headers.length;

  if (columnCount === 0 || rowCount === 0) {
    throw new Error("表格数据无效：列数或行数为0");
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();

    const tableValues: string[][] = [headers, ...rows];

    const table = selection.insertTable(rowCount, columnCount, Word.InsertLocation.after, tableValues);

    table.load("rows");
    await context.sync();

    applyTableGridLook(table);

    // Only bold the first row when we actually have data rows.
    if (rows.length > 0 && table.rows.items.length > 0) {
      const headerRow = table.rows.items[0];
      headerRow.font.bold = true;
    }

    await context.sync();
  });
}

/**
 * 在文档末尾插入 Word 表格
 */
export async function appendTable(tableData: TableData): Promise<void> {
  const { headers, rows } = tableData;
  const rowCount = rows.length + 1;
  const columnCount = headers.length;

  if (columnCount === 0 || rowCount === 0) {
    throw new Error("表格数据无效：列数或行数为0");
  }

  return Word.run(async (context) => {
    const body = context.document.body;

    const tableValues: string[][] = [headers, ...rows];

    const table = body.insertTable(rowCount, columnCount, Word.InsertLocation.end, tableValues);

    table.load("rows");
    await context.sync();

    applyTableGridLook(table);

    if (rows.length > 0 && table.rows.items.length > 0) {
      const headerRow = table.rows.items[0];
      headerRow.font.bold = true;
    }

    await context.sync();
  });
}

/**
 * 在文档起始或末尾插入 Word 表格
 */
export async function insertTableAtLocation(
  tableData: TableData,
  location: "start" | "end"
): Promise<void> {
  const { headers, rows } = tableData;
  const rowCount = rows.length + 1;
  const columnCount = headers.length;

  if (columnCount === 0 || rowCount === 0) {
    throw new Error("表格数据无效：列数或行数为0");
  }

  return Word.run(async (context) => {
    const body = context.document.body;
    const insertLocation =
      location === "start" ? Word.InsertLocation.start : Word.InsertLocation.end;

    const tableValues: string[][] = [headers, ...rows];

    const table = body.insertTable(rowCount, columnCount, insertLocation, tableValues);

    table.load("rows");
    await context.sync();

    applyTableGridLook(table);

    if (rows.length > 0 && table.rows.items.length > 0) {
      const headerRow = table.rows.items[0];
      headerRow.font.bold = true;
    }

    await context.sync();
  });
}

/**
 * 替换选中内容为 Word 表格
 */
export async function replaceSelectionWithTable(tableData: TableData): Promise<void> {
  const { headers, rows } = tableData;
  const rowCount = rows.length + 1;
  const columnCount = headers.length;

  if (columnCount === 0 || rowCount === 0) {
    throw new Error("表格数据无效：列数或行数为0");
  }

  return Word.run(async (context) => {
    const selection = context.document.getSelection();

    // 先删除选中内容
    selection.delete();
    await context.sync();

    // 获取新的选区位置
    const newSelection = context.document.getSelection();
    const tableValues: string[][] = [headers, ...rows];

    const table = newSelection.insertTable(rowCount, columnCount, Word.InsertLocation.after, tableValues);

    table.load("rows");
    await context.sync();

    applyTableGridLook(table);

    if (rows.length > 0 && table.rows.items.length > 0) {
      const headerRow = table.rows.items[0];
      headerRow.font.bold = true;
    }

    await context.sync();
  });
}
