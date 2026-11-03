import {
  createCommandContext,
  EMPTY_BYTES,
  InMemoryFs,
  unsafeBytesFromLatin1,
} from "just-bash";
import { execa } from "execa";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createNodeCommand } from "./node";
import { chatLayout } from "../../test/helpers/chat-layout";

vi.mock("execa");

/** What every `node` but `node --version` is started with ahead of its own arguments. */
const PRELOAD = ["--import", expect.stringMatching(/preload\.mjs$/)];

describe("nodeCommand", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const layout = chatLayout(chatId);
  const command = createNodeCommand(chatId);
  const chatRoot = layout.chat.shellRoot;
  const hostPath = (...parts: string[]) =>
    path.join(layout.chat.hostRoot, ...parts);

  const ctx = (stdin = "") =>
    createCommandContext({
      cwd: chatRoot,
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: stdin ? unsafeBytesFromLatin1(stdin) : EMPTY_BYTES,
    });

  beforeEach(() => {
    vi.mocked(execa).mockResolvedValue({ all: "", exitCode: 0 } as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([[[]], [["--verbose"]]])(
    "refuses %j, with no file, -e or stdin, without spawning node",
    async (args) => {
      const result = await command.execute(args, ctx());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /requires a file (path )?argument or -e <code>/,
      );
      expect(execa).not.toHaveBeenCalled();
    },
  );

  it.each(["--inspect-brk=9229", "--watch", "-i"])(
    "refuses %s without spawning node",
    async (flag) => {
      const result = await command.execute([flag, "./work/a.js"], ctx());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`${flag} is not available`);
      expect(execa).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["runs --version without the preload", ["--version"], ["--version"]],
    ["runs -v as --version", ["-v"], ["--version"]],
    [
      "runs -e code as written, real paths included",
      ["-e", `fs.readFileSync("${chatRoot}/attachments/chart.svg")`],
      [
        ...PRELOAD,
        "-e",
        `fs.readFileSync("${chatRoot}/attachments/chart.svg")`,
      ],
    ],
    ["runs --eval as -e", ["--eval", "1"], [...PRELOAD, "-e", "1"]],
    ["prints -p code", ["-p", "1+1"], [...PRELOAD, "-p", "1+1"]],
    [
      "prints -e code when a bare -p follows it",
      ["-e", "1+1", "-p"],
      [...PRELOAD, "-p", "1+1"],
    ],
    [
      "forwards -c as --check",
      ["-c", "./a.js"],
      [...PRELOAD, "--check", "./a.js"],
    ],
    [
      "forwards flags it does not know, ahead of the file",
      ["--env-file=work/.env", "--no-warnings", "./work/a.js"],
      [...PRELOAD, "--env-file=work/.env", "--no-warnings", "./work/a.js"],
    ],
    [
      "keeps node flags before the file and script args after it",
      ["--max-old-space-size=4096", "./build.js", "--output", "./dist"],
      [
        ...PRELOAD,
        "--max-old-space-size=4096",
        "./build.js",
        "--output",
        "./dist",
      ],
    ],
    // Unchanged but for its spelling, which on Windows turns from the shell's
    // (`/c/...`) to the host's, as node.exe reads it.
    [
      "passes an absolute path in a forwarded flag value as the host spells it",
      [`--env-file=${chatRoot}/work/.env`, "./work/a.js"],
      [...PRELOAD, `--env-file=${hostPath("work", ".env")}`, "./work/a.js"],
    ],
    [
      "passes an absolute script path as the host spells it",
      [`${chatRoot}/scripts/run.js`],
      [...PRELOAD, hostPath("scripts", "run.js")],
    ],
  ])("%s", async (_label, args, expected) => {
    await command.execute(args, ctx());

    expect(execa).toHaveBeenCalledWith(
      process.execPath,
      expected,
      expect.any(Object),
    );
  });

  it.each([
    [
      ["--input-type=module", "--check"],
      "export const x = 1\n",
      [...PRELOAD, "--check", "--input-type", "module"],
    ],
    [[], `fs.readFileSync("${chatRoot}/work/a.txt")`, [...PRELOAD]],
  ])(
    "runs the program from stdin, as written, when %j names no file",
    async (args, stdin, expected) => {
      await command.execute(args, ctx(stdin));

      expect(execa).toHaveBeenCalledWith(
        process.execPath,
        expected,
        expect.objectContaining({ input: Buffer.from(stdin, "latin1") }),
      );
    },
  );
});
