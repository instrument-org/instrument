import fs from "node:fs";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";

import { TASK_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";

interface TaskDatabaseQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

const READ_ONLY_ACTIONS = new Set([
  constants.SQLITE_FUNCTION,
  constants.SQLITE_PRAGMA,
  constants.SQLITE_READ,
  constants.SQLITE_RECURSIVE,
  constants.SQLITE_SELECT,
]);

const READ_ONLY_SQL = /^\s*(?:explain|pragma|select|with)\b/i;

export function queryTaskDatabase({
  databasePath,
  sql,
}: {
  databasePath: string;
  sql: string;
}): TaskDatabaseQueryResult {
  if (!READ_ONLY_SQL.test(sql)) {
    throw new TypeError(
      "Only SELECT, WITH, EXPLAIN, and PRAGMA statements are allowed",
    );
  }

  const database = new DatabaseSync(resolveTaskDatabasePath(databasePath), {
    allowExtension: false,
    readOnly: true,
  });
  database.setAuthorizer((actionCode) =>
    READ_ONLY_ACTIONS.has(actionCode)
      ? constants.SQLITE_OK
      : constants.SQLITE_DENY,
  );

  try {
    const statement = database.prepare(sql);
    return {
      columns: statement.columns().map((column) => column.name),
      rows: statement.all().map(normalizeRow),
    };
  } finally {
    database.close();
  }
}

export function resolveTaskDatabasePath(inputPath: string): string {
  const absoluteInputPath = path.resolve(inputPath);
  const databasePath = fs.statSync(absoluteInputPath).isDirectory()
    ? path.join(absoluteInputPath, TASK_FOLDER_NAMES.private, TASK_DB_FILE_NAME)
    : absoluteInputPath;

  if (!fs.statSync(databasePath).isFile()) {
    throw new TypeError(`Task database not found: ${databasePath}`);
  }

  return databasePath;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { base64: Buffer.from(value).toString("base64") };
  }
  return value;
}
