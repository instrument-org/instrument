import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AbsolutePath } from "../../schemas/paths";
import type { TaskIdSchema } from "../../schemas/task-id";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { TaskDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { createBashEnv } from "../create-bash-env";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { virtualizeOutput } from "./rg";

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
            access: "read-only",
            createdAt: Date.now(),
            id: FolderAttachment.IdSchema.parse("docs-id"),
            mountName: "Docs",
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

  it("searches piped input rather than the task folder", async () => {
    const result = await run(
      "printf '%s\\n' apple banana apricot | rg --color=never ap",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("apple\napricot\n");
  });

  it("reports no match on piped input instead of matching a task file", async () => {
    const result = await run("printf 'haystack\\n' | rg --color=never NEEDLE");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("treats an explicit `-` path as the pipe", async () => {
    const result = await run("printf 'one two\\n' | rg --color=never -c two -");
    expect(result.stdout.trim()).toBe("1");
  });

  it("prefers an explicit path over the pipe", async () => {
    const result = await run(
      "printf 'apple\\n' | rg --color=never NEEDLE work",
    );
    expect(result.stdout).toContain("work/a.ts");
  });

  it("forwards non-ASCII piped bytes unchanged", async () => {
    const result = await run("printf 'café déjà\\n' | rg --color=never 'café'");
    expect(result.stdout).toBe("café déjà\n");
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

  it("leaves backslashes in matched lines alone", async () => {
    await fs.writeFile(
      path.join(taskRoot, "work", "escapes.ts"),
      String.raw`const NEEDLE = { re: /a\d+/, nl: "x\n" };` + "\n",
    );

    const result = await run("rg NEEDLE work/escapes.ts");

    expect(result.stdout).toContain(String.raw`/a\d+/`);
    expect(result.stdout).toContain(String.raw`"x\n"`);
  });
});

describe("virtualizeOutput", () => {
  // ripgrep runs with `--path-separator=/`, so it prints a host root in its
  // POSIX spelling whatever the layout stores.
  function layoutFor(hostRoot: string) {
    return buildWorkspaceFsLayout({
      attachedFolders: {
        docs: {
          access: "read-only",
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("docs-id"),
          mountName: "Docs",
          // Cast: AbsolutePathSchema rejects win32 absolute paths when the test
          // runs on a posix host, but a Windows build stores exactly this shape.
          path: hostRoot as AbsolutePath,
          source: "user",
        },
      },
      taskHostRoot: TaskDirSchema.parse("/workspace/tasks/test"),
    });
  }

  it("rewrites a windows host root printed with forward slashes", () => {
    const layout = layoutFor(String.raw`C:\Users\dev\Downloads`);

    expect(
      virtualizeOutput("C:/Users/dev/Downloads/note.md:1:NEEDLE\n", layout),
    ).toBe("/mnt/Docs/note.md:1:NEEDLE\n");
  });

  it("rewrites a posix host root", () => {
    const layout = layoutFor("/Users/dev/Downloads");

    expect(
      virtualizeOutput("/Users/dev/Downloads/note.md:1:NEEDLE\n", layout),
    ).toBe("/mnt/Docs/note.md:1:NEEDLE\n");
  });
});
