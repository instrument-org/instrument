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
 * Guards the local patch to just-bash's `MountableFs`, carried until the
 * upstream fix (vercel-labs/just-bash#422) is released: a copy from one mount
 * into another finishes around an entry it cannot copy and reports the
 * failures together, rather than ending at the first one. Without the patch,
 * `cp -R` of any attached folder holding a symlink stops at the link with
 * `EPERM: operation not permitted, symlink ...`, everything after it uncopied,
 * and the errno is the one the attached-folders prompt reserves for a macOS
 * denial of the folder.
 */
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let attachedDir: string;
let taskRoot: string;
let taskId: TaskId;

async function run(access: FolderAttachment.Access, command: string) {
  const bash = await createBashEnv({
    attachedFolders: {
      Docs: {
        access,
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
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-symlinks-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(attachedDir, "sub"), { recursive: true });
  await fs.writeFile(path.join(attachedDir, "readme.txt"), "hello docs");
  await fs.writeFile(path.join(attachedDir, "sub", "deep.txt"), "deep");
  await fs.symlink("readme.txt", path.join(attachedDir, "link.txt"));
  await fs.symlink("../readme.txt", path.join(attachedDir, "sub", "up"));
  await fs.writeFile(path.join(attachedDir, "zed.txt"), "zed");
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.each<FolderAttachment.Access>(["read-only", "read-write"])(
  "cp -R of a %s mount holding symlinks",
  (access) => {
    it("copies everything but the links and names them", async () => {
      const result = await run(access, "cp -R /mnt/Docs work/copy");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatchInlineSnapshot(`
        "cp: cannot copy '/mnt/Docs': copied all but 2 entries: EPERM: operation not permitted, symlink '/work/copy/link.txt'; EPERM: operation not permitted, symlink '/work/copy/sub/up'
        "
      `);
      const copied = path.join(taskRoot, "work", "copy");
      await expect(
        fs.readFile(path.join(copied, "readme.txt"), "utf8"),
      ).resolves.toBe("hello docs");
      await expect(
        fs.readFile(path.join(copied, "zed.txt"), "utf8"),
      ).resolves.toBe("zed");
      await expect(
        fs.readFile(path.join(copied, "sub", "deep.txt"), "utf8"),
      ).resolves.toBe("deep");
      await expect(fs.lstat(path.join(copied, "link.txt"))).rejects.toThrow();
      await expect(fs.lstat(path.join(copied, "sub", "up"))).rejects.toThrow();
    });

    it("copies a subtree with no links in it cleanly", async () => {
      await fs.rm(path.join(attachedDir, "sub", "up"));
      const result = await run(access, "cp -R /mnt/Docs/sub work/sub");

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      await expect(
        fs.readFile(path.join(taskRoot, "work", "sub", "deep.txt"), "utf8"),
      ).resolves.toBe("deep");
    });
  },
);
