import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the local patch to just-bash's `find`, carried until the upstream
 * fix (vercel-labs/just-bash#414) is released: a directory it cannot read is
 * reported and skipped rather than ending the whole search. Without the patch,
 * every recursive `find` over an attached home folder returns nothing, since
 * every macOS home holds one such directory.
 *
 * Runs against a real directory with its mode cleared, which root can read
 * regardless, so it is skipped there rather than failing for the wrong reason.
 */
const asRoot = process.getuid?.() === 0;

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let attachedDir: string;
let lockedDir: string;
let taskId: TaskId;

async function run(command: string) {
  const bash = await createBashEnv({
    attachedFolders: {
      Home: {
        access: "read-only",
        createdAt: Date.now(),
        id: FolderAttachment.IdSchema.parse("home-id"),
        mountName: "Home",
        path: TaskDirSchema.parse(attachedDir),
        source: "user",
      },
    },
    sessionId,
    taskId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "find-unreadable-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Home");
  lockedDir = path.join(attachedDir, ".Trash");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(attachedDir, "Documents"), { recursive: true });
  await fs.mkdir(lockedDir, { recursive: true });
  await fs.writeFile(path.join(lockedDir, "old.md"), "gone\n");
  await fs.writeFile(
    path.join(attachedDir, "Documents", "notes.md"),
    "# notes\n",
  );
  await fs.chmod(lockedDir, 0o000);
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.chmod(lockedDir, 0o700);
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.skipIf(asRoot)("find over an unreadable directory in a mount", () => {
  it("reports the directory and keeps going", async () => {
    const result = await run("find /mnt/Home -name '*.md'");

    expect(result.stdout).toBe("/mnt/Home/Documents/notes.md\n");
    expect(result.stderr).toBe("find: /mnt/Home/.Trash: Permission denied\n");
    expect(result.exitCode).toBe(1);
  });

  it("keeps the results reachable through a pipeline", async () => {
    const result = await run(
      "find /mnt/Home -name '*.md' 2>/dev/null | head -1",
    );

    expect(result.stdout).toBe("/mnt/Home/Documents/notes.md\n");
    expect(result.exitCode).toBe(0);
  });
});
