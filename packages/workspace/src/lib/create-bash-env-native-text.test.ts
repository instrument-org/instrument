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
import {
  findWithHiddenEntriesPruned,
  grepWalks,
  quietRefusedFolders,
  quoteWindowsArgument,
  xargsRunsParallel,
} from "./shell-commands/native-text";
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

describe("quietRefusedFolders", () => {
  it("counts the folders the sandbox refused instead of listing each", () => {
    expect(
      quietRefusedFolders(
        [
          "Error: /Users/sam/.ssh: Operation not permitted (os error 1)",
          "find: ‘x’: No such file or directory",
          "Error: /Users/sam/Library: Operation not permitted (os error 1)",
          "",
        ].join("\n"),
      ),
    ).toMatchInlineSnapshot(`
      "find: ‘x’: No such file or directory
      find: left out 2 folders the person keeps closed
      "
    `);
    expect(quietRefusedFolders("find: other\n")).toBe("find: other\n");
  });
});

describe("findWithHiddenEntriesPruned", () => {
  it.each<[string[], string[], string]>([
    [[], [], "( -name .instrument ) -prune -o ( -true ) -print"],
    [
      ["-L", "tree", "-name", "*.md"],
      ["./tasks"],
      "-L tree ( -name .instrument -o -path ./tasks ) -prune -o ( -name *.md ) -print",
    ],
    [
      [".", "-type", "f", "-printf", "%f\\n"],
      [],
      ". ( -name .instrument ) -prune -o ( -type f -printf %f\\n )",
    ],
  ])("%j pruning %j", (args, paths, expected) => {
    expect(findWithHiddenEntriesPruned(args, paths).join(" ")).toBe(expected);
  });
});

describe("quoteWindowsArgument", () => {
  it.each([
    ["*", '"*"'],
    ["*.md", '"*.md"'],
    ["[%s]\\n", '"[%s]\\n"'],
    ["a b", '"a b"'],
    ["", '""'],
    ['say "hi"', '"say \\"hi\\""'],
    ["C:\\dir\\", '"C:\\dir\\\\"'],
    ['a\\"b', '"a\\\\\\"b"'],
  ])("%j becomes %s", (arg, quoted) => {
    expect(quoteWindowsArgument(arg)).toBe(quoted);
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

describe("xargsRunsParallel", () => {
  it.each<[string[], boolean]>([
    [["-P", "4", "sleep"], true],
    [["-P4", "sleep"], true],
    [["-P", "0", "sleep"], true],
    [["-0P4", "sleep"], true],
    [["-n", "1", "-P", "2", "sleep"], true],
    [["--max-procs=4", "sleep"], true],
    [["--max-procs", "4", "sleep"], true],
    [["-I", "-P", "echo", "-P"], false],
    [["-n1", "grep", "-P", "x"], false],
    [["--delimiter", "-P", "echo"], false],
    [["-iP", "echo"], false],
    [["--", "-P"], false],
    [["-n", "1", "sleep"], false],
  ])("%j is %s", (args, expected) => {
    expect(xargsRunsParallel(args)).toBe(expected);
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

  it.each([
    ["factor 12", "12: 2 2 3\n"],
    ["printf 'a b\\nb c\\n' | tsort", "a\nb\nc\n"],
    ["printf 'one two three\\n' | fmt -w 8", "one two\nthree\n"],
    ["echo hi | base32", "NBUQU===\n"],
    ["sha512sum a.txt | cut -c1-16", "bcdb03f1145159cc\n"],
  ])(
    "answers %s with GNU's flags, which just-bash has no command for",
    async (command, stdout) => {
      expect(await run(command)).toMatchObject({ exitCode: 0, stdout });
    },
  );

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

  it.skipIf(process.platform === "win32")(
    "answers find with uutils, -printf and -prune included",
    async () => {
      const result = await run(
        "command -v find; find . -path ./.instrument -prune -o -name '*.txt' -printf '%f\\n' | sort",
      );
      const [program, ...names] = result.stdout.trim().split("\n");
      expect(program).toMatch(/uutils\/find$/);
      expect(names).toEqual(["a.txt", "b.txt", "dupes.txt", "nums.txt"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps the private folder out of a native find",
    async () => {
      const plain = await run("find . -name '*.txt' | sort");
      const listed = await run("find . | sort");
      expect(plain.stdout).not.toContain(CHAT_FOLDER_NAMES.private);
      expect(listed.stdout).not.toContain(CHAT_FOLDER_NAMES.private);
      expect(plain.stdout).toContain("./a.txt");
    },
  );

  it("runs xargs -P at once, which uutils xargs runs one at a time", async () => {
    const started = performance.now();
    const result = await run(
      "printf '0.5\\n%.0s' 1 2 3 4 | xargs -P 4 -n 1 sleep && echo done",
    );
    expect(result.stdout).toBe("done\n");
    // Four half-second sleeps: about 0.5 s at once, 2 s one at a time.
    expect(performance.now() - started).toBeLessThan(1500);
  });

  // The builtin xargs answers every -P call, so it has to read the attached
  // and combined option forms models write, which the patch's xargs part adds.
  it.each([
    ["printf 'a\\nb\\n' | xargs -P4 -n1 echo", "a\nb\n"],
    ["printf 'a\\nb\\n' | xargs -P2 -I{} echo {}x", "ax\nbx\n"],
    ["printf 'a b\\0c\\0' | xargs -0 -P2 -n1 echo", "a b\nc\n"],
    ["printf 'a b\\0c\\0' | xargs -0P2 -n1 echo", "a b\nc\n"],
    ["printf 'a b\\nc\\n' | xargs --max-procs=2 -L1 echo", "a b\nc\n"],
  ])("reads xargs' option forms under -P: %s", async (command, stdout) => {
    const result = await run(command);
    expect({ stdout: result.stdout, stderr: result.stderr }).toEqual({
      stdout,
      stderr: "",
    });
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

describe.skipIf(!existsSync("/usr/bin/diff"))("with the system's diff", () => {
  it("answers diff -y, which the builtin lacks", async () => {
    const result = await run("diff -y -W 20 a.txt b.txt");
    expect(result.exitCode).toBe(1);
    // BSD and GNU diff pad the columns differently.
    expect(result.stdout).toMatch(/^one\s+one\ntwo\s+\|\s+2\n$/);
  });
});

describe.skipIf(!existsSync("/usr/bin/tar"))("with the system's tar", () => {
  it("makes and opens a gzipped archive, leaving the private folder out", async () => {
    const result = await run(
      [
        "mkdir -p pack/.instrument && cp a.txt pack && echo s > pack/.instrument/x",
        "tar czf pack.tgz pack && tar tzf pack.tgz | sort",
        "mkdir -p out && tar -C out -xzf pack.tgz && cat out/pack/a.txt",
        "tar czf - a.txt | tar tzf -",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "pack/
      pack/a.txt
      one
      two
      a.txt
      "
    `);
  });
});
