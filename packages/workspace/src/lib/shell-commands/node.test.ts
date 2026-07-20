import {
  type CommandContext,
  EMPTY_BYTES,
  InMemoryFs,
  unsafeBytesFromLatin1,
} from "just-bash";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../task-dir-utils";
import { createNodeCommand } from "./node";

vi.mock("execa");

const realFs = new InMemoryFs();

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: realFs,
  stdin: EMPTY_BYTES,
};

describe("nodeCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createNodeCommand(taskId);

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("errors when no arguments provided", async () => {
    const result = await command.execute([], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "node command requires a file argument or -e <code>. Prefer \`tsx\` for TypeScript files.",
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
      ["-e", "console.log('hello')"],
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
      ["-e", "console.log('hello')"],
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
      ["-p", "1+1"],
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
      ["-p", "1+1"],
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
      ["--check", "work/check.js"],
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
      ["--check", "work/check.js"],
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
      ["--check", "--input-type", "module"],
      expect.objectContaining({
        input: Buffer.from("export const x = 1\n", "latin1"),
      }),
    );
  });

  it("bridges quoted /task paths in a stdin program", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([], {
      ...mockCtx,
      cwd: "/task",
      stdin: unsafeBytesFromLatin1('fs.readFileSync("/task/work/a.txt")'),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      [],
      expect.objectContaining({
        input: Buffer.from('fs.readFileSync("./work/a.txt")', "latin1"),
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
      expect.arrayContaining(["--output", "dist", "--verbose"]),
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

  it("bridges quoted /task paths inside -e code", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(
      ["-e", 'fs.readFileSync("/task/attachments/chart.svg")'],
      { ...mockCtx, cwd: "/task" },
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      process.execPath,
      ["-e", 'fs.readFileSync("./attachments/chart.svg")'],
      expect.any(Object),
    );
  });

  it("rejects -e code referencing /mnt paths without spawning", async () => {
    const { execa } = await import("execa");

    const result = await command.execute(
      ["-e", 'fs.readFileSync("/mnt/Photos/clip.mov")'],
      mockCtx,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Copy the file into the task first");
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("resolves the script file path without exposing the host dir", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["/scripts/run.js"], mockCtx);

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    assert(Array.isArray(calledArgs), "expected args array");
    expect(calledArgs[0]).not.toContain(taskDir(taskId));
    expect(calledArgs[0]).toBe("scripts/run.js");
  });
});
