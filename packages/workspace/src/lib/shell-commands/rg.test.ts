import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TaskIdSchema } from "../../schemas/task-id";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { TaskDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { createBashEnv } from "../create-bash-env";

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskRoot: string;
let attachedDir: string;
let taskId: ReturnType<typeof TaskIdSchema.parse>;

async function run(command: string, attach = false) {
  const bash = await createBashEnv({
    attachedFolders: attach
      ? {
          docs: {
            createdAt: Date.now(),
            id: FolderAttachment.IdSchema.parse("docs-id"),
            name: "Docs",
            path: TaskDirSchema.parse(attachedDir),
            source: "user",
          },
        }
      : undefined,
    sessionId,
    taskId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rg-command-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, ".instrument"), { recursive: true });
  await fs.mkdir(attachedDir, { recursive: true });

  await fs.writeFile(
    path.join(taskRoot, "work", "a.ts"),
    "const NEEDLE = 1;\n",
  );
  await fs.writeFile(
    path.join(taskRoot, ".instrument", "state.json"),
    '{"host":"NEEDLE"}',
  );
  await fs.writeFile(path.join(attachedDir, "note.md"), "NEEDLE attached\n");

  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("rg command", () => {
  it("shadows the built-in and searches the task", async () => {
    const result = await run("rg NEEDLE");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("work/a.ts");
  });

  it("composes with pipes like any other command", async () => {
    const result = await run("rg -l NEEDLE | wc -l");
    expect(result.stdout.trim()).toBe("1");
  });

  it("never walks the private dir, even when asked for hidden files", async () => {
    const result = await run("rg --hidden NEEDLE");
    expect(result.stdout).not.toContain("state.json");
    expect(result.stdout).toContain("work/a.ts");
  });

  it("refuses an explicit path into the private dir", async () => {
    const result = await run("rg NEEDLE /task/.instrument/state.json");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("not accessible");
  });

  it.each([
    { command: "rg --pre /bin/sh NEEDLE", flag: "--pre" },
    { command: "rg --pre-glob '*' NEEDLE", flag: "--pre-glob" },
    { command: "rg -z NEEDLE", flag: "-z" },
    { command: "rg -uz NEEDLE", flag: "-z" },
    { command: "rg --search-zip NEEDLE", flag: "--search-zip" },
    { command: "rg --hostname-bin /bin/echo NEEDLE", flag: "--hostname-bin" },
  ])("refuses $flag, which would run another program", async ({ command }) => {
    const result = await run(command);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("runs another program");
  });

  it("searches an attached folder and reports its mount path, not the host path", async () => {
    const result = await run("rg NEEDLE /mnt/Docs", true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/mnt/Docs/note.md");
    expect(result.stdout).not.toContain(attachedDir);
  });
});
