import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * just-bash's own `mktemp` writes under /tmp, which no mount covers, so it
 * fails on every call. Every shell names a file with ours instead.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskId: TaskId;

async function run(command: string, { chat = false } = {}) {
  const bash = await createBashEnv({
    chat: chat
      ? { childMounts: [], id: ChatIdSchema.parse(taskId) }
      : undefined,
    sessionId,
    taskId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-mktemp-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("mktemp in the agent's shells", () => {
  it("names a file in the task's temp dir in a task's shell", async () => {
    const result = await run('f=$(mktemp) && test -f "$f" && echo "$f"');
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout.trim()).toMatch(/^\/task\/\.tmp\/tmp\.\w{10}$/);
  });

  it("names a file in the chat's shell too", async () => {
    const result = await run('f=$(mktemp) && test -f "$f" && echo "$f"', {
      chat: true,
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout.trim()).toMatch(/^\/task\/\.tmp\/tmp\.\w{10}$/);
  });
});
