import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskDir } from "../task-dir-utils";
import { createPythonCommand } from "./python";

vi.mock("execa");
vi.mock("./uv", () => ({
  ensureTaskVenv: vi.fn(),
}));

const realFs = new InMemoryFs();

const mockCtx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: realFs,
  stdin: EMPTY_BYTES,
});

describe("pythonCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createPythonCommand(taskId);

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("bridges quoted /task paths inside -c code", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute(
      ["-c", 'open("/task/attachments/chart.svg")'],
      mockCtx,
    );

    const calledArgs = vi.mocked(execa).mock.calls.at(-1)?.[1];
    expect(calledArgs).toEqual(["-c", 'open("./attachments/chart.svg")']);
  });

  it("bridges quoted /task paths in a heredoc program on stdin", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes('print(open("/task/work/data.csv").read())'),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        input: Buffer.from('print(open("./work/data.csv").read())'),
      }),
    );
  });

  it("leaves stdin alone when a script file argument is present", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const data = 'rows mentioning "/task/x" are data, not code';
    await command.execute(["work/script.py"], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes(data),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      ["work/script.py"],
      expect.objectContaining({ input: Buffer.from(data) }),
    );
  });

  it("forwards non-ASCII stdin bytes unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    await command.execute([], {
      ...mockCtx,
      stdin: encodeUtf8ToBytes("print('café → déjà')"),
    });

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        input: Buffer.from("print('café → déjà')", "utf8"),
      }),
    );
  });

  it("blocks a script file with an absolute /task path and explains the fix", async () => {
    const { execa } = await import("execa");
    const workDir = path.join(taskDir(taskId), "work");
    await fs.mkdir(workDir, { recursive: true });
    const scriptPath = path.join(workDir, "report.py");
    await fs.writeFile(scriptPath, 'open("/task/output/report.txt", "w")');

    try {
      const result = await command.execute(["work/report.py"], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("task-relative");
      expect(vi.mocked(execa)).not.toHaveBeenCalled();
    } finally {
      await fs.rm(scriptPath, { force: true });
    }
  });

  it("rejects -c code referencing /mnt paths without spawning", async () => {
    const { execa } = await import("execa");

    const result = await command.execute(
      ["-c", 'open("/mnt/Photos/clip.mov")'],
      mockCtx,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Copy the file into the task first");
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });
});
