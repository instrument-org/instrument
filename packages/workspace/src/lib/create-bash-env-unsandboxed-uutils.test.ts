import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { wrapNativeCommand } from "./native-sandbox";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock(import("./native-sandbox"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, wrapNativeCommand: vi.fn(actual.wrapNativeCommand) };
});

/**
 * uutils calls the reviewed rules let run outside the native sandbox
 * (`shell-commands/unsandboxed-uutils.ts`): each corpus command prints the
 * same bytes, exit code and stderr with the rules on as fully sandboxed.
 * The binaries are the ones Studio's postinstall vendors; a checkout without
 * them skips these.
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
let chatId: ChatId;

/**
 * A file whose name holds a newline, which the operand check has to quote
 * rather than split. Windows has no way to make one, so there it is left out
 * of the fixture and of the cases that name it.
 */
const namedWithNewline =
  process.platform === "win32" ? undefined : "two\nlines.txt";

async function run(command: string, outside: boolean) {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    uutilsOutsideSandbox: outside,
  });
  const bash = await createBashEnv({ chatId, sessionId });
  const { exitCode, stderr, stdout } = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return { exitCode, stderr, stdout };
}

/** How many programs the last command started unwrapped. */
function unwrapped() {
  return vi
    .mocked(wrapNativeCommand)
    .mock.calls.filter(([, , reach]) => reach === null).length;
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-unsandboxed-uutils-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "unsandboxed");
  await fs.mkdir(chatRoot, { recursive: true });
  const lines = Array.from(
    { length: 20_000 },
    (_, i) => `w${(i * 7919) % 997} ${i}`,
  );
  await fs.writeFile(path.join(chatRoot, "words.txt"), `${lines.join("\n")}\n`);
  await fs.writeFile(path.join(chatRoot, "a.txt"), "one\ntwo\nthree\n");
  await fs.writeFile(path.join(chatRoot, "b.txt"), "two\nfour\n");
  await fs.writeFile(path.join(chatRoot, "dupes.txt"), "a\na\nb\nc\nc\n");
  await fs.writeFile(path.join(chatRoot, "nums.txt"), "10\n1e3\n2.5\n-1\n");
  await fs.writeFile(path.join(chatRoot, "bin.dat"), Buffer.from("a\0b\n"));
  if (namedWithNewline !== undefined) {
    await fs.writeFile(path.join(chatRoot, namedWithNewline), "x\n");
  }
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    nativeSandbox: true,
    uutilsDir: AbsolutePathSchema.parse(UUTILS_DIR),
  });
});

beforeEach(() => {
  vi.mocked(wrapNativeCommand).mockClear();
});

afterAll(async () => {
  const {
    nativeSandbox: _,
    uutilsDir: __,
    uutilsOutsideSandbox: ___,
    ...config
  } = getWorkspaceConfig();
  setWorkspaceConfig(config);
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(vendored)("uutils outside the sandbox", () => {
  it.each(
    [
      "head -n 2 a.txt",
      "head -2 words.txt",
      "head -c 7 a.txt",
      "tail -n 3 words.txt",
      "tail -n +2 a.txt",
      "tail -c 20 words.txt",
      'for f in a.txt b.txt; do head -1 "$f"; done',
      "sort -u nums.txt",
      "sort -g nums.txt",
      "sort -t' ' -k2,2n words.txt | tail -2",
      "sort words.txt | md5sum",
      "uniq -c dupes.txt",
      "uniq -d dupes.txt",
      "cut -d' ' -f1 words.txt | sort | uniq -c | sort -rn | head -3",
      "cut -c1-2 a.txt",
      "wc -l words.txt",
      "wc -c a.txt",
      "wc -w a.txt",
      "wc -m a.txt",
      "wc -L a.txt",
      "wc -l < a.txt",
      "wc -lw a.txt",
      "wc -l a.txt b.txt",
      "wc -l a.txt | cat",
      "wc -l 'two\nlines.txt'",
      "cat a.txt | wc -l",
      "grep -n two a.txt",
      "grep -c w1 words.txt",
      "grep -H one a.txt",
      "grep -l one a.txt",
      "grep -L zzz a.txt",
      "grep -o 'w9[0-9]*' words.txt | head -2",
      "grep a bin.dat",
      "grep -m1 -b 'w5 ' words.txt",
      "grep two a.txt b.txt",
      "grep zzz a.txt; echo $?",
      "grep -q one a.txt; echo $?",
      "grep -e one -e two a.txt",
      "od -c a.txt | head -2",
      "base32 a.txt",
      "fmt -w 5 a.txt",
      "date -u -d @0 +%Y-%m-%dT%H:%M",
      "date -d @86400 +%F",
      "seq 1 5 | sort -rn",
      "seq -s, 3",
      "factor 12",
      "numfmt --to=iec 2048",
      "sha256sum < a.txt",
      "md5sum < a.txt",
      "head -n 1 missing.txt",
      "head -n 1 .instrument/x",
      "tail -n 1 a.txt nope.txt",
      "sort --bogus a.txt",
    ].filter(
      (command) => namedWithNewline !== undefined || !command.includes("\n"),
    ),
  )("prints what the sandboxed run prints: %s", async (command) => {
    const sandboxed = await run(command, false);
    const kinds = vi
      .mocked(wrapNativeCommand)
      .mock.results.map((result) =>
        result.type === "return" ? result.value.kind : "threw",
      );
    // Off, every program is wrapped where this machine has a sandbox.
    expect(unwrapped()).toBe(0);
    if (process.platform === "darwin") {
      expect(kinds).not.toContain("unwrapped");
    }
    expect(await run(command, true)).toEqual(sandboxed);
  });

  it.each([
    ["head -n 2 a.txt", 1],
    ["seq 3 | sort -r", 2],
    ["wc -l a.txt", 1],
    ["grep -H one a.txt", 1],
    ['for f in a.txt b.txt; do head -1 "$f"; done', 2],
    // A second operand, and a walk, stay in the sandbox.
    ["wc -l a.txt b.txt", 0],
    ["grep -r one .", 0],
    // wc's stdout handed straight to the next program would miss the name.
    ["wc -l a.txt | cat", 0],
  ])("%s starts %i programs unwrapped", async (command, count) => {
    await run(command, true);
    expect(unwrapped()).toBe(count);
  });

  it("ends a producer cut off by its reader with SIGPIPE's status, quietly", async () => {
    expect(
      await run(
        "set -o pipefail; seq 1 100000 | head -1; echo $? ${PIPESTATUS[@]}",
        true,
      ),
    ).toEqual({ exitCode: 0, stderr: "", stdout: "1\n141 141 0\n" });
    expect(unwrapped()).toBe(2);
  });

  it("joins unwrapped stages to a sandboxed one by their pipes", async () => {
    // pr is not on the list, so it stays wrapped between the others.
    const command =
      "head -n 3 words.txt | pr -t | sort -r | head -1; echo ${PIPESTATUS[@]}";
    const sandboxed = await run(command, false);
    vi.mocked(wrapNativeCommand).mockClear();
    expect(await run(command, true)).toEqual(sandboxed);
    expect(sandboxed.stdout).toBe("w940 1\n0 0 0 0\n");
    expect(unwrapped()).toBe(3);
  });

  it("keeps what the agent exported from the program", async () => {
    const result = await run(
      `export DYLD_INSERT_LIBRARIES=${tmpDir}/nope.dylib LD_PRELOAD=${tmpDir}/nope.so TZ=/etc/passwd TMPDIR=${os.homedir()}/closed POSIXLY_CORRECT=1; head -1 a.txt; date -u -d @0 +%Y; sort -r a.txt | head -1`,
      true,
    );
    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "one\n1970\ntwo\n",
    });
    expect(unwrapped()).toBe(4);
  });
});
