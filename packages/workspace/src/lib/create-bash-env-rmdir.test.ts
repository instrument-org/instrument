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
 * Guards the just-bash patch for upstream #527: unpatched, `ReadWriteFs` hands
 * a non-recursive `rm` of a directory to Node's `fs.promises.rm`, which refuses
 * every directory with EISDIR, so `rmdir` and `find -delete` fail on every
 * writable mount. Plain `rm` of a directory has to keep failing.
 */
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let attachedDir: string;
let taskRoot: string;
let taskId: TaskId;

async function run(command: string) {
  const bash = await createBashEnv({
    attachedFolders: {
      Docs: {
        access: "read-write",
        createdAt: Date.now(),
        id: FolderAttachment.IdSchema.parse("docs-id"),
        mountName: "Docs",
        path: TaskDirSchema.parse(attachedDir),
        source: "user",
      },
    },
    sessionId,
    taskId,
  });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return { exitCode: result.exitCode, stderr: result.stderr };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rmdir-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(taskRoot, "work", "empty"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, "work", "full"), { recursive: true });
  await fs.writeFile(path.join(taskRoot, "work", "full", "a.txt"), "a");
  await fs.mkdir(path.join(attachedDir, "empty"), { recursive: true });
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("rmdir on a writable mount", () => {
  it.each([
    ["/task", "work/empty", () => path.join(taskRoot, "work", "empty")],
    ["/mnt", "/mnt/Docs/empty", () => path.join(attachedDir, "empty")],
  ])("removes an empty directory in %s", async (_, target, hostPath) => {
    expect(await run(`rmdir ${target}`)).toEqual({ exitCode: 0, stderr: "" });
    await expect(fs.stat(hostPath())).rejects.toThrow("ENOENT");
  });

  it("removes nested empty directories with -p", async () => {
    await fs.mkdir(path.join(taskRoot, "work", "a", "b"), { recursive: true });

    expect(await run("rmdir -p work/a/b")).toEqual({ exitCode: 0, stderr: "" });
    await expect(fs.stat(path.join(taskRoot, "work", "a"))).rejects.toThrow(
      "ENOENT",
    );
  });

  it("refuses a directory that is not empty", async () => {
    expect(await run("rmdir work/full")).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "rmdir: failed to remove 'work/full': Directory not empty
      ",
      }
    `);
    expect(await fs.readdir(path.join(taskRoot, "work", "full"))).toEqual([
      "a.txt",
    ]);
  });

  it("leaves an empty attached folder's own directory in place", async () => {
    await fs.rm(path.join(attachedDir, "empty"), { recursive: true });

    expect((await run("rmdir /mnt/Docs")).exitCode).toBe(1);
    expect((await fs.stat(attachedDir)).isDirectory()).toBe(true);
  });

  it("lets find -delete remove empty directories", async () => {
    expect(await run("find work/empty -type d -empty -delete")).toEqual({
      exitCode: 0,
      stderr: "",
    });
    await expect(fs.stat(path.join(taskRoot, "work", "empty"))).rejects.toThrow(
      "ENOENT",
    );
  });
});

describe("rm without -r", () => {
  it.each(["work/empty", "/mnt/Docs/empty"])(
    "refuses the directory %s",
    async (target) => {
      const result = await run(`rm ${target}`);
      expect(result).toEqual({
        exitCode: 1,
        stderr: `rm: cannot remove '${target}': Is a directory\n`,
      });
    },
  );
});
