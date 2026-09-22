import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the awk part of the local just-bash patch, carried until upstream
 * releases the fix (vercel-labs/just-bash, the awk printf PR): `printf` reads
 * the size of what awk has written from a running count instead of measuring
 * the whole output on every call. Without it, `printf` over 20,000 records
 * takes about ten seconds where `print` takes a tenth of one.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskId: TaskId;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-awk-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("awk printf", () => {
  it("formats many records in linear time", async () => {
    // Guarded by the test timeout.
    const bash = await createBashEnv({ sessionId, taskId });

    const result = await bash.exec(
      `seq 1 20000 | awk '{ printf "%s\\n", $0 }' | wc -l`,
      { signal: AbortSignal.timeout(30_000) },
    );

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("20000");
  });
});
