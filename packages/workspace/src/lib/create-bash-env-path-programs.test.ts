import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { RG_DISK_PATH } from "./ripgrep";

/**
 * A name no builtin or command of ours answers runs the program by that name
 * on the computer's PATH, and the commands that say what exists (`which`,
 * `command -v`, `type`, `hash`) see those programs too.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatRoot: string;
let binDir: string;
let chatId: ChatId;
let originalPath: string | undefined;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

async function writeProgram(dir: string, name: string, body: string) {
  await fs.writeFile(path.join(dir, name), `#!/bin/sh\n${body}\n`, {
    mode: 0o755,
  });
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-path-programs-")),
  );
  chatRoot = path.join(tmpDir, "chats", "test");
  binDir = path.join(tmpDir, "bin");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(binDir);
  await writeProgram(
    binDir,
    "path-echo",
    'printf "args=%s cwd=%s in=%s\\n" "$*" "$PWD" "$(cat)"',
  );
  // Same names as a builtin and one of our commands, which keep them.
  await writeProgram(binDir, "ls", "echo fake ls");
  await writeProgram(binDir, "rg", "echo fake rg");
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  process.env.PATH = originalPath;
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.skipIf(process.platform === "win32")("programs on PATH", () => {
  it("runs one with its arguments, stdin, and the shell's directory", async () => {
    const result = await run(
      "mkdir -p sub && cd sub && echo piped | path-echo a 'b c'",
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `args=a b c cwd=${chatRoot}/sub in=piped\n`,
    });
  });

  it("runs a real system program", async () => {
    const result = await run("uname -s");
    expect(result).toMatchObject({ exitCode: 0, stdout: `${os.type()}\n` });
  });

  it("leaves builtins and our commands their names", async () => {
    const result = await run("ls -d .; rg --version | head -1");
    expect(result.stdout).not.toContain("fake");
  });

  it("says a missing name is not found", async () => {
    const result = await run("nonexistentcmd123; echo $?");
    expect(result).toMatchObject({
      stderr: "bash: nonexistentcmd123: command not found\n",
      stdout: "127\n",
    });
  });

  it("answers which, command -v, type and hash from the PATH", async () => {
    const result = await run(
      [
        "which path-echo",
        "command -v path-echo",
        "type path-echo",
        "hash path-echo && hash -t path-echo",
        "which nonexistentcmd123; echo $?",
        "command -v nonexistentcmd123; echo $?",
      ].join("\n"),
    );
    const program = path.join(binDir, "path-echo");
    expect(result.stdout.split("\n")).toEqual([
      program,
      program,
      `path-echo is ${program}`,
      program,
      "1",
      "1",
      "",
    ]);
  });

  it("names a builtin as part of the shell, though a program by its name is on PATH", async () => {
    const result = await run(
      [
        "which ls",
        "command -v ls",
        "type ls",
        "type -t ls",
        "hash ls && hash -t ls; echo $?",
        "type file",
      ].join("\n"),
    );
    expect(result.stdout.split("\n")).toEqual([
      "ls",
      "ls",
      "ls is a shell builtin",
      "builtin",
      "1",
      "file is a shell builtin",
      "",
    ]);
  });

  it("names the program one of our commands runs", async () => {
    const venvPython = path.join(chatRoot, ".venv", "bin", "python");
    const result = await run(
      [
        "which python3",
        "command -v python3",
        "type python3",
        "type -t python3",
        "hash python3 && hash -t python3",
        "which rg",
        "which node",
      ].join("\n"),
    );
    expect(result.stdout.split("\n")).toEqual([
      venvPython,
      venvPython,
      `python3 is ${venvPython}`,
      "file",
      venvPython,
      RG_DISK_PATH,
      process.execPath,
      "",
    ]);
  });

  it("lists our command first and then every program with -a", async () => {
    const result = await run("which -a ls");
    expect(result.stdout.split("\n").slice(0, 2)).toEqual([
      "ls",
      path.join(binDir, "ls"),
    ]);
  });

  it("runs a script a path names natively, and one with no #! line itself", async () => {
    const result = await run(
      [
        `printf '#!/bin/sh\\necho native $0\\n' > native.sh`,
        `printf 'echo interpreted\\n' > plain.sh`,
        "chmod +x native.sh plain.sh",
        "./native.sh",
        "./plain.sh",
        "command -v ./native.sh",
      ].join("\n"),
    );
    expect(result.stdout).toBe(
      `native ${chatRoot}/native.sh\ninterpreted\n./native.sh\n`,
    );
  });
});
