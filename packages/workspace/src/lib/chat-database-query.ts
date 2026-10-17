import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";

import { CHAT_DB_FILE_NAME } from "../constants";

interface ChatDatabaseQueryResult {
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

export function queryChatDatabase({
  databasePath,
  sql,
}: {
  databasePath: string;
  sql: string;
}): ChatDatabaseQueryResult {
  if (!READ_ONLY_SQL.test(sql)) {
    throw new TypeError(
      "Only SELECT, WITH, EXPLAIN, and PRAGMA statements are allowed",
    );
  }

  const database = new DatabaseSync(resolveChatDatabasePath(databasePath), {
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

/**
 * The database a path names: the file itself, or the one in a chat's record
 * folder, or in its `.instrument/` for a folder a build from before records
 * moved apart from work left.
 */
export function resolveChatDatabasePath(inputPath: string): string {
  const absoluteInputPath = path.resolve(inputPath);
  const inRecordFolder = path.join(absoluteInputPath, CHAT_DB_FILE_NAME);
  const databasePath = fs.statSync(absoluteInputPath).isDirectory()
    ? fs.existsSync(inRecordFolder)
      ? inRecordFolder
      : path.join(absoluteInputPath, PRIVATE_FOLDER_NAME, CHAT_DB_FILE_NAME)
    : absoluteInputPath;

  if (!fs.statSync(databasePath).isFile()) {
    throw new TypeError(`Chat database not found: ${databasePath}`);
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
