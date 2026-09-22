import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the `ls` part of the local just-bash patch, carried until upstream
 * releases the fix (vercel-labs/just-bash, the linear-output PR and #390): `ls`
 * writes its output into one builder rather than re-measuring everything it
 * has written on every line, and charges each name it reads against the
 * traversal entry limit the way `find` does. Without the first, `ls -l` on a
 * 10,000-entry directory takes about thirty seconds; without the second, a
 * recursive listing is bounded by how many directories it enters rather than
 * how much of the tree it reads, and walks most of a home folder before the
 * budget stops it.
 *
 * The second is observable only against a budget the tree exceeds, which is
 * what the orchestrator's smaller one is for here, so this also pins that the
 * orchestrator's shell has that smaller budget and a task's does not.
 */
const DIRECTORIES = 3;
const FILES_PER_DIRECTORY = 10_000;

const sessionId = StoreId.newSessionId();

let tmpDir: string;
let attachedDir: string;
let taskId: TaskId;

async function run(command: string, { orchestrator = false } = {}) {
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
    orchestrator: orchestrator ? { childMounts: [] } : undefined,
    sessionId,
    taskId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-ls-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Home");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  for (let d = 0; d < DIRECTORIES; d++) {
    const dir = path.join(attachedDir, `d${String(d).padStart(2, "0")}`);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(
      Array.from({ length: FILES_PER_DIRECTORY }, (_, f) =>
        fs.writeFile(path.join(dir, `f${String(f).padStart(5, "0")}`), ""),
      ),
    );
  }
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("ls over a large attached folder", () => {
  it("lists a large directory in long format in linear time", async () => {
    // Guarded by the test timeout.
    const result = await run("ls -l /mnt/Home/d00 | wc -l");

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(String(FILES_PER_DIRECTORY + 1));
  });

  it("stops a recursive listing at the orchestrator's entry budget", async () => {
    const result = await run("ls -R /mnt/Home", { orchestrator: true });

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/ls: filesystem traversal .*limit exceeded/);
  });

  it("stops find at the same budget without leaving reads running", async () => {
    // A directory read still in flight when find fails used to settle after
    // the command returned and surface as an unhandled rejection, which
    // vitest reports as a failed run (vercel-labs/just-bash#451).
    const result = await run("find /mnt/Home -type f", { orchestrator: true });

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toMatch(
      /find: filesystem traversal .*limit exceeded/,
    );
  });

  it("lists the whole tree from a task, whose budget is larger", async () => {
    const result = await run("ls -R /mnt/Home | wc -l");

    expect(result.exitCode).toBe(0);
    expect(Number(result.stdout.trim())).toBeGreaterThan(
      DIRECTORIES * FILES_PER_DIRECTORY,
    );
  });
});
