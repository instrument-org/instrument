import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AbsolutePath } from "../../schemas/paths";

import { MountedFolder } from "../../schemas/mounted-folder";
import { ChatDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { createBashEnv } from "../create-bash-env";
import { virtualizeHostPaths } from "../filter-shell-output";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { ChatIdSchema } from "../../schemas/chat-id";

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskRoot: string;
let attachedDir: string;
let chatId: ReturnType<typeof ChatIdSchema.parse>;

async function run(command: string, attach: boolean | string = false) {
  const mountName = typeof attach === "string" ? attach : "Docs";
  const bash = await createBashEnv({
    folders: attach
      ? {
          [mountName]: {
            access: "read-only",
            id: MountedFolder.IdSchema.parse("docs-id"),
            mountName,
            path: ChatDirSchema.parse(attachedDir),
          },
        }
      : undefined,
    sessionId,
    chatId,
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

  chatId = createMockChatConfigForDir(ChatDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("rg command", () => {
  // A task handed a folder inside one of its chat's mounts holds the
  // directories above it with nothing else in them.
  it.each(["/mnt", "/mnt/Home"])(
    "searches the mounts under %s, which holds no mount itself",
    async (root) => {
      const result = await run(`rg -l NEEDLE ${root}`, "Home/Docs");
      expect(result.stdout).toBe("/mnt/Home/Docs/note.md\n");
      expect(result.exitCode).toBe(0);
    },
  );

  it("searches the chat's /apps mount, which the chat's shell has", async () => {
    const appDir = path.join(getWorkspaceConfig().appsDir, "rg-weather");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(path.join(appDir, "app.ts"), "const NEEDLE = 2;\n");
    try {
      const bash = await createBashEnv({
        chat: { id: ChatIdSchema.parse(chatId) },
        sessionId,
        chatId,
      });
      const result = await bash.exec("rg -l NEEDLE /apps/rg-weather", {
        signal: AbortSignal.timeout(30_000),
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("/apps/rg-weather/app.ts\n");
    } finally {
      await fs.rm(appDir, { force: true, recursive: true });
    }
  });

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

  // Guards the `stdinConnected` half of the local just-bash patch: a pipe that
  // carried nothing is still a pipe, so ripgrep reads it and matches nothing
  // rather than walking the task folder as if it had been run bare.
  it.each([
    ["a producer that printed nothing", "printf '' | rg --color=never NEEDLE"],
    ["a producer that failed", "false | rg --color=never NEEDLE"],
    ["a pipe into a group", "printf '' | { rg --color=never NEEDLE; }"],
  ])(
    "reads an empty pipe from %s instead of walking the task",
    async (_, command) => {
      const result = await run(command);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
    },
  );

  it("reads an empty pipe when it is a middle stage", async () => {
    const result = await run("printf '' | rg --color=never NEEDLE | wc -c");
    expect(result.stdout.trim()).toBe("0");
  });

  it("walks the task again once the pipeline is over", async () => {
    const result = await run("printf '' | rg NEEDLE; rg -l NEEDLE");
    expect(result.stdout.trim()).toBe("work/a.ts");
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

  // ripgrep applies no glob filter to a file named on the command line, so the
  // deny glob that covers the walk says nothing about these.
  it.each([
    { as: "a file", command: "rg NEEDLE .instrument/state.json" },
    { as: "a directory to walk", command: "rg --hidden NEEDLE .instrument" },
    { as: "a traversal", command: "rg NEEDLE work/../.instrument/state.json" },
  ])("refuses the private dir named relatively, $as", async ({ command }) => {
    const result = await run(command);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("host");
    expect(result.stderr + result.stdout).toContain("private");
  });

  // ripgrep's glob precedence is last-wins, so the agent's own glob is applied
  // after ours and re-includes what ours took out.
  it.each([
    "rg --hidden --glob '.instrument/**' NEEDLE",
    "rg --hidden --iglob '.INSTRUMENT/**' NEEDLE",
    "rg --hidden -g '**' --files",
  ])("keeps the private dir out of `%s`", async (command) => {
    const result = await run(command);

    expect(result.stdout).not.toContain("state.json");
  });

  // ripgrep anchors a glob at its working directory and matches it against
  // each path as printed, so a search root named any other way than the
  // working directory walks straight past an exclusion anchored there.
  it.each([
    "rg --hidden NEEDLE /task",
    "rg --hidden NEEDLE /task/",
    "cd work && rg --hidden NEEDLE /task",
    "cd work && rg -uu NEEDLE ..",
    "cd work && rg -uu NEEDLE ../",
    "cd work && rg --hidden --no-ignore NEEDLE ./..",
    "cd work && rg -uu NEEDLE ../work/..",
    "cd work && rg -uu NEEDLE ././..",
    "cd work && rg -uu NEEDLE .//..",
    "cd work && rg -uu NEEDLE ../../test",
    "cd work && rg -uu NEEDLE -- ..",
    "cd work && rg -uu -g '**' NEEDLE ..",
    "cd work && rg -uu --iglob '*.JSON' --iglob '*.ts' NEEDLE /task",
    "cd work && rg -uu --files ..",
    "cd work && rg -uu --files /task",
    "cd work && rg -uu --files /task work ..",
  ])("keeps the private dir out of `%s`", async (command) => {
    const result = await run(command);

    expect(result.stdout).not.toContain("state.json");
    expect(result.stdout).toContain("a.ts");
  });

  it("keeps an empty pattern, which matches every line", async () => {
    const result = await run(
      "printf 'x\\n\\n' > work/b.txt; rg -c '' work/b.txt",
    );

    expect(result.stdout.trim()).toBe("2");
  });

  // A search root spelled with glob metacharacters is named literally by the
  // glob that anchors the exclusion there.
  it("keeps the private dir out of a root spelled with glob metacharacters", async () => {
    await fs.mkdir(path.join(taskRoot, "work", "[x]*{y}?"));

    const result = await run("cd work && rg -uu NEEDLE '[x]*{y}?/../..'");

    expect(result.stdout).not.toContain("state.json");
    expect(result.stdout).toContain("a.ts");
  });

  it.each([
    { as: "in another case", command: "rg NEEDLE .INSTRUMENT/state.json" },
    {
      as: "after `--` with a leading dash",
      command:
        "cd work && mkdir ./-x && rg NEEDLE -- -x/../../.instrument/state.json",
    },
  ])("refuses a file in the private dir named $as", async ({ command }) => {
    const result = await run(command);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("host");
    expect(result.stderr).toContain("private");
  });

  // The deny glob is a flag, so it has to land ahead of the operand separator
  // rather than after the arguments it is appended to.
  it("still searches when the pattern is given after `--`", async () => {
    const result = await run("rg -- NEEDLE");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("work/a.ts");
  });

  it.each([
    { command: "rg --pre /bin/sh NEEDLE", flag: "--pre" },
    { command: "rg --pre-glob '*' NEEDLE", flag: "--pre-glob" },
    { command: "rg -z NEEDLE", flag: "-z" },
    { command: "rg -uz NEEDLE", flag: "-z" },
    // The cluster carries a value on its last flag, which is where the
    // all-letters test for a bundled `-z` stopped matching.
    { command: "rg -zC3 NEEDLE", flag: "-z bundled with a value flag" },
    { command: "rg --search-zip NEEDLE", flag: "--search-zip" },
    { command: "rg --hostname-bin /bin/echo NEEDLE", flag: "--hostname-bin" },
  ])("refuses $flag, which would run another program", async ({ command }) => {
    const result = await run(command);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("runs another program");
  });

  // `-e` takes the rest of the cluster as its value, so this is a search for
  // the pattern `z` rather than a bundled `-z`.
  it("searches for a pattern attached to -e instead of reading it as -z", async () => {
    const result = await run("rg -ez");

    expect(result.stderr).not.toContain("runs another program");
    expect(result.exitCode).toBe(1);
  });

  // ripgrep reads flags from the file named by RIPGREP_CONFIG_PATH, so a `--pre`
  // there would reach the binary the argv denylist never sees. Were the config
  // honored, ripgrep would search /bin/echo's output (the file paths) instead of
  // the files and never find NEEDLE; the match proves the config was ignored.
  it("ignores a --pre smuggled through RIPGREP_CONFIG_PATH", async () => {
    const result = await run(
      "printf '%s\\n' '--pre=/bin/echo' > work/rgc; " +
        "RIPGREP_CONFIG_PATH=work/rgc rg --color=never NEEDLE",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("work/a.ts");
  });

  it("searches a folder mount and reports its mount path, not the host path", async () => {
    const result = await run("rg NEEDLE /mnt/Docs", true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/mnt/Docs/note.md");
    expect(result.stdout).not.toContain(attachedDir);
  });

  it("stops at its output cap and points at filtering inside rg", async () => {
    await fs.writeFile(
      path.join(attachedDir, "big.txt"),
      "NEEDLE\n".repeat(1_500_000),
    );

    const result = await run("rg NEEDLE /mnt/Docs | wc -l", true);

    expect(result.stdout.trim()).toBe("0");
    expect(result.stderr).toMatch(/^rg: stopped after 8 MB of output.*--iglob/);
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

// A chat's folder mounts at /task with its `tasks/` dir masked: what an
// earlier version left there is nothing of the chat's.
describe("rg command in a chat", () => {
  const childId = ChatIdSchema.parse(`01k${"rgchild".padEnd(23, "0")}`);
  let chatFolder: string;
  let childDir: string;

  async function runInChat(command: string) {
    const made = chatFor();
    chatFolder = chatDir(made);
    childDir = path.join(chatFolder, "tasks", childId);
    await fs.mkdir(path.join(chatFolder, "work"), { recursive: true });
    await fs.mkdir(path.join(childDir, ".instrument"), { recursive: true });
    await fs.mkdir(path.join(childDir, "output"), { recursive: true });
    await fs.writeFile(path.join(chatFolder, "work", "a.ts"), "NEEDLE chat\n");
    await fs.writeFile(
      path.join(childDir, ".instrument", "settings.json"),
      "NEEDLE sentinel\n",
    );
    await fs.writeFile(
      path.join(childDir, "output", "report.md"),
      "NEEDLE report\n",
    );
    const bash = await createBashEnv({
      chat: {
        id: made,
      },
      sessionId: StoreId.newSessionId(),
      chatId: made,
    });
    return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
  }

  afterEach(async () => {
    await fs.rm(chatFolder, { force: true, recursive: true });
  });

  it.each([
    "rg -uu NEEDLE",
    "rg -uu NEEDLE /task",
    "cd work && rg -uu NEEDLE ..",
    "cd work && rg -uu NEEDLE /task",
    "cd work && rg -uu NEEDLE ../work/..",
    "cd work && rg -uu --files ..",
    "cd work && rg -uu -g '**' --files /task",
  ])("keeps the tasks dir out of `%s`", async (command) => {
    const result = await runInChat(command);

    expect(result.stdout).toContain("a.ts");
    expect(result.stdout).not.toMatch(/sentinel|report|settings\.json/);
  });
});

describe("virtualizeHostPaths on what rg prints", () => {
  // ripgrep runs with `--path-separator=/`, so it prints a host root in its
  // POSIX spelling whatever the layout stores.
  function layoutFor(hostRoot: string) {
    return buildWorkspaceFsLayout({
      folders: {
        docs: {
          access: "read-only",
          id: MountedFolder.IdSchema.parse("docs-id"),
          mountName: "Docs",
          // Cast: AbsolutePathSchema rejects win32 absolute paths when the test
          // runs on a posix host, but a Windows build stores exactly this shape.
          path: hostRoot as AbsolutePath,
        },
      },
      taskHostRoot: ChatDirSchema.parse("/workspace/tasks/test"),
    });
  }

  it("rewrites a windows host root printed with forward slashes", () => {
    const layout = layoutFor(String.raw`C:\Users\dev\Downloads`);

    expect(
      virtualizeHostPaths("C:/Users/dev/Downloads/note.md:1:NEEDLE\n", layout),
    ).toBe("/mnt/Docs/note.md:1:NEEDLE\n");
  });

  it("rewrites a posix host root", () => {
    const layout = layoutFor("/Users/dev/Downloads");

    expect(
      virtualizeHostPaths("/Users/dev/Downloads/note.md:1:NEEDLE\n", layout),
    ).toBe("/mnt/Docs/note.md:1:NEEDLE\n");
  });
});
