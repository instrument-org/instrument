import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { createBashEnv } from "../create-bash-env";
import { chatDir } from "../record-folders";
import { workDir } from "../work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { workspaceLayout } from "../workspace-layout";
import { shellPath } from "../workspace-fs-layout";
import { type ChatIdSchema } from "../../schemas/chat-id";

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatRoot: string;
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
  chatRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(attachedDir, { recursive: true });

  await fs.writeFile(
    path.join(chatRoot, "work", "a.ts"),
    "const NEEDLE = 1;\n",
  );
  await fs.writeFile(path.join(attachedDir, "note.md"), "NEEDLE attached\n");

  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("rg command", () => {
  it("searches the chat's apps folder, which the chat's shell has", async () => {
    const appDir = path.join(getWorkspaceConfig().appsDir, "rg-weather");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(path.join(appDir, "app.ts"), "const NEEDLE = 2;\n");
    try {
      const bash = await createBashEnv({
        role: "chat",
        sessionId,
        chatId,
      });
      const result = await bash.exec(`rg -l NEEDLE '${shellPath(appDir)}'`, {
        signal: AbortSignal.timeout(30_000),
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${shellPath(appDir)}/app.ts\n`);
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

  it("searches piped input rather than the chat's folder", async () => {
    const result = await run(
      "printf '%s\\n' apple banana apricot | rg --color=never ap",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("apple\napricot\n");
  });

  it("reports no match on piped input instead of matching a file in the chat's folder", async () => {
    const result = await run("printf 'haystack\\n' | rg --color=never NEEDLE");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  // Guards the `stdinConnected` half of the local just-bash patch: a pipe that
  // carried nothing is still a pipe, so ripgrep reads it and matches nothing
  // rather than walking the chat's folder as if it had been run bare.
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

  it("keeps an empty pattern, which matches every line", async () => {
    const result = await run(
      "printf 'x\\n\\n' > work/b.txt; rg -c '' work/b.txt",
    );

    expect(result.stdout.trim()).toBe("2");
  });

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

  it("searches a folder it reaches and reports its real paths", async () => {
    const result = await run(`rg NEEDLE '${shellPath(attachedDir)}'`, true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${shellPath(attachedDir)}/note.md`);
  });

  it("stops at its output cap and points at filtering inside rg", async () => {
    await fs.writeFile(
      path.join(attachedDir, "big.txt"),
      "NEEDLE\n".repeat(1_500_000),
    );

    const result = await run(
      `rg NEEDLE '${shellPath(attachedDir)}' | wc -l`,
      true,
    );

    expect(result.stdout.trim()).toBe("0");
    expect(result.stderr).toMatch(/^rg: stopped after 8 MB of output.*--iglob/);
  });

  it("leaves backslashes in matched lines alone", async () => {
    await fs.writeFile(
      path.join(chatRoot, "work", "escapes.ts"),
      String.raw`const NEEDLE = { re: /a\d+/, nl: "x\n" };` + "\n",
    );

    const result = await run("rg NEEDLE work/escapes.ts");

    expect(result.stdout).toContain(String.raw`/a\d+/`);
    expect(result.stdout).toContain(String.raw`"x\n"`);
  });
});

// A chat's shell starts in its work folder, apart from its records: what the
// person sent is searched where it is, and the rest of the record folder is
// the workspace's.
describe("rg command in a chat", () => {
  async function runInChat(
    command: string,
    spell: (hostPath: string) => string = shellPath,
  ) {
    // The record folder in a workspace, which the rules keep hidden, and the
    // work folder in this computer's folder for it.
    const rootDir = path.join(tmpDir, "workspace");
    const machineDir = path.join(tmpDir, "machine");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      chatsDir: AbsolutePathSchema.parse(workspaceLayout(rootDir).chatsDir),
      rootDir: WorkspaceDirSchema.parse(rootDir),
      workFoldersDir: AbsolutePathSchema.parse(path.join(machineDir, "work")),
      workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
    });
    const made = chatFor();
    const recordFolder = chatDir(made);
    const work = workDir(made);
    await fs.mkdir(path.join(work, "work"), { recursive: true });
    await fs.mkdir(path.join(recordFolder, "attachments"), { recursive: true });
    await fs.writeFile(path.join(work, "work", "a.ts"), "NEEDLE chat\n");
    await fs.writeFile(
      path.join(recordFolder, "attachments", "note.md"),
      "NEEDLE sent\n",
    );
    await fs.writeFile(path.join(recordFolder, "chat.db"), "NEEDLE sentinel\n");
    const bash = await createBashEnv({
      role: "chat",
      sessionId: StoreId.newSessionId(),
      chatId: made,
    });
    return bash.exec(command.replaceAll("RECORD", `'${spell(recordFolder)}'`), {
      signal: AbortSignal.timeout(30_000),
    });
  }

  it("walks the work folder, where the shell starts", async () => {
    const result = await runInChat("rg -uu NEEDLE");

    expect(result.stdout).toContain("work/a.ts");
    expect(result.stdout).not.toMatch(/sentinel|sent/);
  });

  it("searches what the person sent in the record folder", async () => {
    const result = await runInChat("rg -uu NEEDLE RECORD/attachments");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("attachments/note.md");
  });

  // The agent names the record folder by its shell path, and on Windows can
  // also type its drive path, which ripgrep opens as the same folder.
  it.each([
    ...["rg -uu NEEDLE RECORD", "rg NEEDLE RECORD/chat.db"].map(
      (command) => [command, "its shell path", shellPath] as const,
    ),
    ...(process.platform === "win32"
      ? ["rg -uu NEEDLE RECORD", "rg NEEDLE RECORD/chat.db"].map(
          (command) =>
            [
              command,
              "its drive path",
              (hostPath: string) => hostPath,
            ] as const,
        )
      : []),
  ])(
    "keeps the rest of the record folder out of `%s`, named by %s",
    async (command, _spelling, spell) => {
      const result = await runInChat(command, spell);

      expect(result.stdout).not.toContain("sentinel");
      expect(result.exitCode).not.toBe(0);
    },
  );
});
