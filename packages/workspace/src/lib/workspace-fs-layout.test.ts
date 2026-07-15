import { APP_NAME_SLUG } from "@instrument-org/shared";
import { Bash } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema, TaskDirSchema } from "../schemas/paths";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  TASK_MOUNT_POINT,
} from "./workspace-fs-layout";

describe("buildBashFs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-bash-fs-test-`),
    );
    await fs.mkdir(path.join(tmpDir, "task"));
    await fs.mkdir(path.join(tmpDir, "Docs"));
    await fs.writeFile(path.join(tmpDir, "Docs", "readme.txt"), "hello docs");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  async function makeBash() {
    const layout = buildWorkspaceFsLayout({
      attachedFolders: {
        docs: {
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("docs-id"),
          name: "Docs",
          path: AbsolutePathSchema.parse(path.join(tmpDir, "Docs")),
          source: "user",
        },
      },
      taskHostRoot: TaskDirSchema.parse(path.join(tmpDir, "task")),
    });
    const bashFs = await buildBashFs(layout, {
      maxFileReadSize: 1024 * 1024,
    });
    return new Bash({ cwd: TASK_MOUNT_POINT, fs: bashFs });
  }

  it("writes relative paths into the real task dir", async () => {
    const bash = await makeBash();
    const result = await bash.exec("echo hi > notes.txt");
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "task", "notes.txt"), "utf8"),
    ).resolves.toBe("hi\n");
  });

  it("reads attached folders at their /mnt path", async () => {
    const bash = await makeBash();
    const result = await bash.exec("cat '/mnt/Docs/readme.txt'");
    expect(result.stdout).toBe("hello docs");
    expect(result.exitCode).toBe(0);
  });

  it("rejects writes into a read-only mount with EROFS", async () => {
    const bash = await makeBash();
    // just-bash raises redirect-target failures as thrown errors rather than
    // exit codes; the bash tool converts them to a failed-command result (see
    // tools/bash.ts). Either way the write must not land.
    await expect(
      bash.exec("echo nope > '/mnt/Docs/new.txt'"),
    ).rejects.toThrow(/EROFS/);
    await expect(
      fs.access(path.join(tmpDir, "Docs", "new.txt")),
    ).rejects.toThrow();
  });

  it("rejects writes outside every mount with EROFS instead of losing them", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mkdir -p /tmp && echo scratch > /tmp/x");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("EROFS");
  });

  it("lists the mount points at the virtual root", async () => {
    const bash = await makeBash();
    const result = await bash.exec("ls /");
    expect(result.stdout.split("\n").filter(Boolean).sort()).toEqual([
      "mnt",
      "task",
    ]);
  });

  it("skips attached mounts whose folder is missing on disk", async () => {
    await fs.rm(path.join(tmpDir, "Docs"), { force: true, recursive: true });
    const bash = await makeBash();
    const result = await bash.exec("ls '/mnt/Docs'");
    expect(result.exitCode).not.toBe(0);
  });
});
