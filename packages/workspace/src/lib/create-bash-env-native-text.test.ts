import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CHAT_FOLDER_NAMES } from "../constants";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { grepWalks, reachesAboveHome } from "./shell-commands/native-text";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * The GNU text commands the bundled uutils answer
 * (`shell-commands/native-text.ts`). The binaries are the ones Studio's
 * postinstall vendors into `apps/studio/resources/uutils`; a checkout that
 * has not run it skips the cases that need them.
 */
const UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../apps/studio/resources/uutils",
);
const vendored = existsSync(
  path.join(
    UUTILS_DIR,
    process.platform === "win32" ? "coreutils.exe" : "coreutils",
  ),
);

const sessionId = StoreId.newSessionId();
let tmpDir: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({ chatId, sessionId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

function withUutils(dir: string | undefined) {
  const { uutilsDir: _, ...config } = getWorkspaceConfig();
  setWorkspaceConfig(
    dir === undefined
      ? config
      : { ...config, uutilsDir: AbsolutePathSchema.parse(dir) },
  );
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-native-text-"));
  chatRoot = path.join(tmpDir, "chats", "native-text");
  await fs.mkdir(path.join(chatRoot, CHAT_FOLDER_NAMES.private), {
    recursive: true,
  });
  await fs.writeFile(path.join(chatRoot, "nums.txt"), "10\n1e3\n2.5\n-1\n");
  await fs.writeFile(path.join(chatRoot, "dupes.txt"), "a\na\nb\n");
  await fs.writeFile(path.join(chatRoot, "a.txt"), "one\ntwo\n");
  await fs.writeFile(path.join(chatRoot, "b.txt"), "one\n2\n");
  await fs.writeFile(
    path.join(chatRoot, CHAT_FOLDER_NAMES.private, "secret.txt"),
    "s\n",
  );
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  withUutils(undefined);
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("reachesAboveHome", () => {
  it.each<[string[], boolean]>([
    [["-r", "x", "/Users/sam"], true],
    [["-r", "x", "/Users/sam/"], true],
    [["-r", "x", "/Users"], true],
    [["-r", "x", "/"], true],
    [["-r", "x", "/Users/sam/Projects/app"], false],
    [["-r", "x", "."], false],
  ])("%j is %s", (args, expected) => {
    expect(reachesAboveHome(args, "/Users/sam")).toBe(expected);
  });
});

describe("grepWalks", () => {
  it.each<[string[], boolean]>([
    [["-r", "x"], true],
    [["-ril", "x"], true],
    [["-R", "x"], true],
    [["--recursive", "x"], true],
    [["-H", "x", "a.txt"], false],
  ])("%j is %s", (args, expected) => {
    expect(grepWalks(args)).toBe(expected);
  });
});

describe.skipIf(!vendored)("with the bundled uutils", () => {
  beforeAll(() => withUutils(UUTILS_DIR));

  it("sorts general numbers as GNU does", async () => {
    const result = await run("sort -g nums.txt");
    expect(result.stdout).toBe("-1\n2.5\n10\n1e3\n");
  });

  it("pads uniq -c to GNU's seven columns", async () => {
    const result = await run("uniq -c dupes.txt");
    expect(result.stdout).toBe("      2 a\n      1 b\n");
  });

  it("answers cmp, which the shell has no builtin for", async () => {
    const result = await run("cmp a.txt b.txt");
    expect(result).toMatchObject({
      exitCode: 1,
      stdout: "a.txt b.txt differ: byte 5, line 2\n",
    });
  });

  it("answers grep -H, which the builtin refuses", async () => {
    const result = await run("grep -H one a.txt");
    expect(result.stdout).toBe("a.txt:one\n");
  });

  it("names the program for a native command and the builtin otherwise", async () => {
    const result = await run("type -t tr; command -v sort");
    const [tr, sort] = result.stdout.trim().split("\n");
    expect(tr).toBe("builtin");
    expect(sort).toMatch(/uutils\/coreutils(?:\.exe)?$/);
  });

  it("keeps the private folder missing to a named operand", async () => {
    const result = await run(`sort ${CHAT_FOLDER_NAMES.private}/secret.txt`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No such file or directory");
  });

  it("carries UTF-8 through a pipeline of native stages", async () => {
    const result = await run(
      "printf 'naïve\\n日本\\nb\\n' | sort | uniq | wc -c",
    );
    expect(result.stdout.trim()).toBe("16");
  });

  it("leaves find to the builtin, which reads -newermt", async () => {
    const result = await run(
      "type -t find; find . -name 'a.txt' -newermt 2000-01-01",
    );
    expect(result.stdout).toBe("builtin\n./a.txt\n");
  });

  it("reads an empty pipe as empty rather than waiting", async () => {
    const result = await run("true | sort | wc -l");
    expect(result.stdout.trim()).toBe("0");
  });
});

describe("without the bundled uutils", () => {
  beforeAll(() => withUutils(undefined));

  it("leaves the shell's own commands in place", async () => {
    const result = await run("sort -g nums.txt");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("invalid option");
  });
});
