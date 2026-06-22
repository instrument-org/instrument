import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import mockFs from "mock-fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { createTsCommand } from "./ts";

vi.mock(import("../execa-node-for-task"));

const realFs = new InMemoryFs();

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: realFs,
  stdin: EMPTY_BYTES,
};

describe("tsCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createTsCommand(taskId);

  afterEach(() => {
    mockFs.restore();
    vi.unstubAllGlobals();
  });

  it("returns version string for --version", async () => {
    vi.stubGlobal("process", { ...process, version: "v20.0.0" });
    const result = await command.execute(["--version"], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": "node v20.0.0",
      }
    `);
  });

  it("returns version string for -v", async () => {
    vi.stubGlobal("process", { ...process, version: "v20.0.0" });
    const result = await command.execute(["-v"], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": "node v20.0.0",
      }
    `);
  });

  it("errors when no file argument provided", async () => {
    const result = await command.execute([], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "tsx command requires a file argument (e.g., tsx scripts/setup.ts). Running tsx without arguments spawns an interactive shell.",
        "stdout": "",
      }
    `);
  });

  it("executes eval code via -e flag by writing a tmp file", async () => {
    mockFs({ [taskDir(taskId)]: {} });

    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "hello",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      ["-e", "console.log('hello')"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execaNodeForTask)).toHaveBeenCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      expect.arrayContaining([
        "dlx",
        "jiti@2.6.1",
        expect.stringContaining("ts-eval-"),
      ]),
      expect.any(Object),
      expect.any(String),
    );
  });

  it("executes eval code via --eval flag by writing a tmp file", async () => {
    mockFs({ [taskDir(taskId)]: {} });

    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "hello",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      ["--eval", "console.log('hello')"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execaNodeForTask)).toHaveBeenCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      expect.arrayContaining([
        "dlx",
        "jiti@2.6.1",
        expect.stringContaining("ts-eval-"),
      ]),
      expect.any(Object),
      expect.any(String),
    );
  });

  it("errors when only flags are provided with no file", async () => {
    const result = await command.execute(["--verbose"], mockCtx);

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "tsx requires exactly one file path as a positional argument (e.g., tsx scripts/setup.ts).",
        "stdout": "",
      }
    `);
  });

  it("passes named flags and their values through to the script", async () => {
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      [
        "./skills/pdf-to-markdown/scripts/convert.ts",
        "--file",
        "./user-provided/test.pdf",
        "--output",
        "./output/test.md",
      ],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execaNodeForTask)).toHaveBeenCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      expect.arrayContaining([
        "dlx",
        "jiti@2.6.1",
        expect.stringContaining("convert.ts"),
        "--file",
        "user-provided/test.pdf",
        "--output",
        "output/test.md",
      ]),
      expect.any(Object),
      expect.any(String),
    );
  });

  it("resolves the script file path without exposing the host dir", async () => {
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(["/scripts/run.ts"], mockCtx);

    const calledPath = vi.mocked(execaNodeForTask).mock.calls.at(-1)?.[2]?.[2];
    expect(calledPath).toBeDefined();
    expect(calledPath).not.toContain(taskDir(taskId));
    expect(calledPath).toBe("scripts/run.ts");
  });
});
