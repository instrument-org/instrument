import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { TypedError } from "./errors";
import { isStorageFullError } from "./is-storage-full-error";

function realSqliteFullError() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (x)");
  db.exec("PRAGMA max_page_count = 2");
  try {
    for (let index = 0; index < 100; index++) {
      db.exec("INSERT INTO t VALUES (randomblob(4000))");
    }
  } catch (error) {
    return error;
  } finally {
    db.close();
  }
  throw new Error("expected the database to fill up");
}

function withProps(message: string, props: Record<string, unknown>) {
  return Object.assign(new Error(message), props);
}

describe("isStorageFullError", () => {
  it.each([
    [
      "ENOSPC from a file write",
      withProps("ENOSPC: no space left on device, open '/x'", {
        code: "ENOSPC",
      }),
    ],
    [
      "node:sqlite SQLITE_FULL",
      withProps("database or disk is full", {
        code: "ERR_SQLITE_ERROR",
        errcode: 13,
      }),
    ],
    [
      "node:sqlite SQLITE_CANTOPEN",
      withProps("unable to open database file", {
        code: "ERR_SQLITE_ERROR",
        errcode: 14,
      }),
    ],
    [
      "an extended SQLITE_CANTOPEN code",
      withProps("unable to open database file", { errcode: 14 | (1 << 8) }),
    ],
    ["a symbolic SQLITE_FULL code", withProps("full", { code: "SQLITE_FULL" })],
    ["the message alone", new Error("Database or disk is full")],
    [
      "a storage error wrapping it",
      new TypedError.Storage("unable to open database file", {
        cause: withProps("unable to open database file", { errcode: 14 }),
      }),
    ],
    [
      "a real node:sqlite error, wrapped",
      new TypedError.Storage("write failed", { cause: realSqliteFullError() }),
    ],
  ])("recognizes %s", (_name, error) => {
    expect(isStorageFullError(error)).toBe(true);
  });

  it.each([
    ["an unrelated error", new Error("boom")],
    [
      "another SQLite error",
      withProps("database is locked", { code: "ERR_SQLITE_ERROR", errcode: 5 }),
    ],
    ["ENOENT", withProps("no such file", { code: "ENOENT" })],
    ["a string", "database or disk is full"],
    ["undefined", undefined],
  ])("does not flag %s", (_name, error) => {
    expect(isStorageFullError(error)).toBe(false);
  });
});
