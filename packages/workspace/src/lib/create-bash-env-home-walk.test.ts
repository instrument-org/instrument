import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * The one agent's shell walks the home folder at the chat's budget and its
 * own folder at a task's (`walk-budget.ts`): a `find` over home stops with a
 * pointer to `rg`, and the same walk over a folder of its own finishes.
 */
const sessionId = StoreId.newSessionId();

/** More entries than the chat's 20,000-entry budget. */
const WIDE_FILES = 21_000;

let tmpDir: string;
let taskId: TaskId;

function shell({ oneAgent }: { oneAgent: boolean }) {
  return createBashEnv({
    attachedFolders: {
      Home: {
        access: "read-only",
        createdAt: Date.now(),
        id: FolderAttachment.IdSchema.parse("home-id"),
        mountName: "Home",
        path: TaskDirSchema.parse(path.join(tmpDir, "Home")),
        source: "user",
      },
    },
    oneAgent,
    sessionId,
    taskId,
  });
}

async function run(command: string, options: { oneAgent: boolean }) {
  const bash = await shell(options);
  return bash.exec(command, { signal: AbortSignal.timeout(60_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-home-walk-"));
  const home = path.join(tmpDir, "Home");
  const taskRoot = path.join(home, "workspace", "tasks", "walker");
  const wide = path.join(home, "wide");
  await fs.mkdir(path.join(taskRoot, "work", "wide"), { recursive: true });
  await fs.mkdir(wide, { recursive: true });
  await Promise.all(
    Array.from({ length: WIDE_FILES }, (_, index) =>
      Promise.all([
        fs.writeFile(path.join(wide, `f${index}`), ""),
        fs.writeFile(path.join(taskRoot, "work", "wide", `f${index}`), ""),
      ]),
    ),
  );
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot));
  // The home folder holds the workspace, which is what marks it as home.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(home, "workspace")),
  });
}, 60_000);

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("the one agent's walks over the home folder", () => {
  it("stop at the chat's budget, pointing at rg", async () => {
    const result = await run("find /mnt/Home -name nothing-here", {
      oneAgent: true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "stopped walking /mnt/Home after 20,000 entries",
    );
    expect(result.stderr).toContain("rg --files");
  });

  it("leave its own folder at a task's budget", async () => {
    const result = await run("find work -type f | wc -l", { oneAgent: true });

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(String(WIDE_FILES));
  });

  it("start over with each call into the same shell", async () => {
    const bash = await shell({ oneAgent: true });
    const first = await bash.exec("find /mnt/Home/wide -name f1");
    expect(first.stderr).toContain("stopped walking");

    const next = await bash.exec("ls /mnt/Home");
    expect(next.stdout).toContain("wide");
  });

  it("are not budgeted apart for a task's shell", async () => {
    const result = await run("find /mnt/Home/wide -type f | wc -l", {
      oneAgent: false,
    });

    expect(result.stdout.trim()).toBe(String(WIDE_FILES));
  });
});
