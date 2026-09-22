import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * `du` walks the real directories behind the mounts in a worker thread rather
 * than the virtual filesystem on the main thread (`shell-commands/du.ts`).
 * Byte counts are asserted with `-b` and `--apparent-size`, since disk usage in
 * blocks depends on the filesystem the test runs on.
 */
const sessionId = StoreId.newSessionId();

/** More entries than the orchestrator's 20,000-entry traversal budget. */
const WIDE_FILES = 21_000;

let tmpDir: string;
let homeDir: string;
let wideDir: string;
let taskId: TaskId;

async function run(command: string, { orchestrator = false } = {}) {
  const attach = (name: string, folder: string) => ({
    access: "read-only" as const,
    createdAt: Date.now(),
    id: FolderAttachment.IdSchema.parse(`${name}-id`),
    mountName: name,
    path: TaskDirSchema.parse(folder),
    source: "user" as const,
  });
  const bash = await createBashEnv({
    attachedFolders: {
      Home: attach("Home", homeDir),
      Wide: attach("Wide", wideDir),
    },
    orchestrator: orchestrator ? { childMounts: [] } : undefined,
    sessionId,
    taskId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-du-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  homeDir = path.join(tmpDir, "Home");
  wideDir = path.join(tmpDir, "Wide");

  await fs.mkdir(path.join(homeDir, "notes", "deep"), { recursive: true });
  await fs.mkdir(path.join(homeDir, "photos"), { recursive: true });
  await fs.writeFile(path.join(homeDir, "notes", "one.txt"), "x".repeat(1500));
  await fs.writeFile(
    path.join(homeDir, "notes", "deep", "two.txt"),
    "y".repeat(3000),
  );
  await fs.writeFile(
    path.join(homeDir, "photos", "big.bin"),
    "z".repeat(50_000),
  );

  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.writeFile(path.join(taskRoot, "work", "small.txt"), "s".repeat(10));
  await fs.mkdir(path.join(taskRoot, TASK_FOLDER_NAMES.private), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(taskRoot, TASK_FOLDER_NAMES.private, "task.db"),
    Buffer.alloc(5_000_000),
  );

  await fs.mkdir(wideDir, { recursive: true });
  await Promise.all(
    Array.from({ length: WIDE_FILES }, (_, i) =>
      fs.writeFile(path.join(wideDir, `f${i}`), ""),
    ),
  );

  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("du", () => {
  it("prints a file's size in bytes and in GNU's rounded-up human form", async () => {
    const bytes = await run("du -b /mnt/Home/notes/one.txt");
    const human = await run("du --apparent-size -h /mnt/Home/notes/one.txt");

    expect(bytes.stdout).toBe("1500\t/mnt/Home/notes/one.txt\n");
    expect(human.stdout).toBe("1.5K\t/mnt/Home/notes/one.txt\n");
  });

  it("lists children before their parent, down to the depth asked", async () => {
    const result = await run("du -b -d 1 /mnt/Home");
    const lines = result.stdout.trim().split("\n");
    const paths = lines.map((line) => line.split("\t")[1]);
    const size = (target: string) =>
      Number(
        lines.find((line) => line.endsWith(`\t${target}`))?.split("\t")[0],
      );

    expect(result.exitCode).toBe(0);
    expect(paths).toEqual(["/mnt/Home/notes", "/mnt/Home/photos", "/mnt/Home"]);
    expect(size("/mnt/Home/notes")).toBeGreaterThanOrEqual(4500);
    expect(size("/mnt/Home")).toBeGreaterThanOrEqual(
      size("/mnt/Home/notes") + size("/mnt/Home/photos"),
    );
  });

  it("prints paths as they were typed, relative ones included", async () => {
    const result = await run("cd /mnt/Home && du -ab notes");

    expect(result.stdout.trim().split("\n").at(-1)).toMatch(/^\d+\tnotes$/);
    expect(result.stdout).toContain("\tnotes/deep/two.txt\n");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("adds a grand total with -c", async () => {
    const result = await run(
      "du -cb /mnt/Home/notes/one.txt /mnt/Home/notes/deep/two.txt",
    );

    expect(result.stdout.trim().split("\n").at(-1)).toBe("4500\ttotal");
  });

  it("neither lists nor counts the task's private dir", async () => {
    const listing = await run("du -ab /task");
    const total = await run("du -sb /task");

    expect(listing.stdout).not.toMatch(/\.instrument/i);
    expect(Number(total.stdout.split("\t")[0])).toBeLessThan(1_000_000);
  });

  it.each([
    [`/task/${TASK_FOLDER_NAMES.private}`],
    [`/task/${TASK_FOLDER_NAMES.private.toUpperCase()}`],
  ])("reports %s as absent", async (target) => {
    const result = await run(`du -sb ${target}`);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `du: cannot access '${target}': No such file or directory\n`,
    );
  });

  it("sums the mounts inside a virtual directory", async () => {
    const result = await run("du -sb /mnt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\t\/mnt\n$/);
  });

  it("answers past the orchestrator's traversal budget", async () => {
    // The walk is not the virtual filesystem's, so the budget that stops
    // find and ls over this folder does not apply to it.
    const result = await run("du -a /mnt/Wide | wc -l", { orchestrator: true });

    expect(result.exitCode).toBe(0);
    expect(Number(result.stdout.trim())).toBe(WIDE_FILES + 1);
  });

  it("leaves a flag it does not implement to just-bash", async () => {
    const result = await run("du --time /mnt/Home");

    expect(result.stderr).toContain("--time");
  });
});
