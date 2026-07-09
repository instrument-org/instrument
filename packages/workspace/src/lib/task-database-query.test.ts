import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";
import {
  queryTaskDatabase,
  resolveTaskDatabasePath,
} from "./task-database-query";

let rootDir: string;
let taskDir: string;
let databasePath: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-database-query-"));
  taskDir = path.join(rootDir, "task");
  const privateDir = path.join(taskDir, TASK_FOLDER_NAMES.private);
  await fs.mkdir(privateDir, { recursive: true });
  databasePath = path.join(privateDir, TASK_DB_FILE_NAME);

  const database = new DatabaseSync(databasePath);
  database.exec(
    "create table sessions (key text primary key, value text, blob blob, created_at text)",
  );
  database
    .prepare("insert into sessions (key, blob, created_at) values (?, ?, ?)")
    .run(
      "messages:example",
      Buffer.from('{"json":{"role":"user"}}'),
      "2026-07-09T00:00:00.000Z",
    );
  database.close();
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("queryTaskDatabase", () => {
  it("queries a task directory read-only and returns raw rows", () => {
    const result = queryTaskDatabase({
      databasePath: taskDir,
      sql: "select key, cast(blob as text) as payload from sessions",
    });

    expect(resolveTaskDatabasePath(taskDir)).toBe(databasePath);
    expect(result.columns).toEqual(["key", "payload"]);
    expect(result.rows).toEqual([
      {
        key: "messages:example",
        payload: '{"json":{"role":"user"}}',
      },
    ]);
  });

  it("rejects write statements", () => {
    expect(() =>
      queryTaskDatabase({
        databasePath,
        sql: "delete from sessions",
      }),
    ).toThrow("Only SELECT, WITH, EXPLAIN, and PRAGMA statements are allowed");
  });
});
