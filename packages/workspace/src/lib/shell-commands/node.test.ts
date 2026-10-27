import {
  createCommandContext,
  EMPTY_BYTES,
  InMemoryFs,
  unsafeBytesFromLatin1,
} from "just-bash";
import path from "node:path";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createNodeCommand } from "./node";
import { chatLayout } from "../../test/helpers/chat-layout";

vi.mock("execa");

const realFs = new InMemoryFs();

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: realFs,
  stdin: EMPTY_BYTES,
});

/** What every `node` but `node --version` is started with ahead of its own arguments. */
const PRELOAD = ["--import", expect.stringMatching(/preload\.mjs$/)];

describe("nodeCommand", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const layout = chatLayout(chatId);
  const command = createNodeCommand(chatId);
  const chatRoot = layout.chat.shellRoot;

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("errors when no arguments provided", async () => {
    const result = await command.execute([], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "node command requires a file argument or -e <code>.",
        "stdout": "",
      }
    `);
  });

  it("errors when only flags are provided with no file or -e", async () => {
    const result = await command.execute(["--verbose"], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "node requires a file path argument or -e <code>.",
        "stdout": "",
      }
    `);
  });

  it("executes --version", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "v20.0.0",
      exitCode: 0,
    } as never);

    const result = await command.execute(["--version"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      ["--version"],
      expect.any(Object),
    );
  });

  it("executes -v as alias for --version", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "v20.0.0",
      exitCode: 0,
    } as never);

    const result = await command.execute(["-v"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      ["--version"],
      expect.any(Object),
    );
  });

  it("executes eval code via -e flag", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "hello",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      ["-e", "console.log('hello')"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "-e", "console.log('hello')"],
      expect.any(Object),
    );
  });

  it("executes eval code via --eval flag", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "hello",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      ["--eval", "console.log('hello')"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "-e", "console.log('hello')"],
      expect.any(Object),
    );
  });

  it.each([
    ["--inspect"],
    ["--inspect-brk=9229"],
    ["--watch"],
    ["--debug"],
    ["-i"],
  ])("refuses %s without spawning node", async (flag) => {
    const { execa } = await import("execa");

    const result = await command.execute([flag, "./work/a.js"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${flag} is not available`);
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("forwards unrecognized node flags instead of dropping them", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(
      ["--env-file=work/.env", "--no-warnings", "./work/a.js"],
      mockCtx,
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "--env-file=work/.env", "--no-warnings", "./work/a.js"],
      expect.any(Object),
    );
  });

  // Unchanged but for its spelling, which on Windows turns from the shell's
  // (`/c/...`) to the host's, as node.exe reads it.
  it("passes an absolute path in a forwarded flag value unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([`--env-file=${chatRoot}/work/.env`, "./work/a.js"], {
      ...mockCtx,
      cwd: chatRoot,
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [
        ...PRELOAD,
        `--env-file=${path.join(layout.chat.hostRoot, "work", ".env")}`,
        "./work/a.js",
      ],
      expect.any(Object),
    );
  });

  it("evaluates and prints code via -p", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "2",
      exitCode: 0,
    } as never);

    await command.execute(["-p", "1+1"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "-p", "1+1"],
      expect.any(Object),
    );
  });

  it("prints -e code when a bare -p flag follows it", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "2",
      exitCode: 0,
    } as never);

    await command.execute(["-e", "1+1", "-p"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "-p", "1+1"],
      expect.any(Object),
    );
  });

  it("forwards --check to node", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["--check", "./work/check.js"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "--check", "./work/check.js"],
      expect.any(Object),
    );
  });

  it("forwards -c as an alias for --check", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["-c", "./work/check.js"], mockCtx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "--check", "./work/check.js"],
      expect.any(Object),
    );
  });

  it("runs the program from stdin when no file is given", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["--input-type=module", "--check"], {
      ...mockCtx,
      stdin: unsafeBytesFromLatin1("export const x = 1\n"),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD, "--check", "--input-type", "module"],
      expect.objectContaining({
        input: Buffer.from("export const x = 1\n", "latin1"),
      }),
    );
  });

  it("passes a stdin program with real paths through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([], {
      ...mockCtx,
      cwd: chatRoot,
      stdin: unsafeBytesFromLatin1(`fs.readFileSync("${chatRoot}/work/a.txt")`),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [...PRELOAD],
      expect.objectContaining({
        input: Buffer.from(
          `fs.readFileSync("${chatRoot}/work/a.txt")`,
          "latin1",
        ),
      }),
    );
  });

  it("passes script args after the file path", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(
      ["./scripts/build.js", "--output", "./dist", "--verbose"],
      mockCtx,
    );

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    expect(calledArgs).toEqual(
      expect.arrayContaining(["--output", "./dist", "--verbose"]),
    );
  });

  it("passes node flags before the file path", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(
      ["--max-old-space-size=4096", "./scripts/build.js"],
      mockCtx,
    );

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    assert(Array.isArray(calledArgs), "expected args array");
    const fileIndex = calledArgs.findIndex((a) =>
      String(a).includes("build.js"),
    );
    const flagIndex = calledArgs.findIndex((a) =>
      String(a).includes("max-old-space-size"),
    );
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(flagIndex).toBeLessThan(fileIndex);
  });

  it("passes -e code with real paths through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(
      ["-e", `fs.readFileSync("${chatRoot}/attachments/chart.svg")`],
      { ...mockCtx, cwd: chatRoot },
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [
        ...PRELOAD,
        "-e",
        `fs.readFileSync("${chatRoot}/attachments/chart.svg")`,
      ],
      expect.any(Object),
    );
  });

  // Unchanged but for its spelling on Windows, as with a flag's value.
  it("passes the script file path unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([`${chatRoot}/scripts/run.js`], mockCtx);

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    assert(Array.isArray(calledArgs), "expected args array");
    expect(calledArgs[PRELOAD.length]).toBe(
      path.join(layout.chat.hostRoot, "scripts", "run.js"),
    );
  });
});
