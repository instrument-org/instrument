import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { runPnpmCommand } from "./run-pnpm";
import { getWorkspaceConfig } from "./workspace-config";

vi.mock(import("./execa-node-for-task"));

describe("runPnpmCommand", () => {
  it("sets pnpm_config_reporter=append-only on the child process env", async () => {
    const { execaNodeForTask } = await import("./execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });

    const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
    await runPnpmCommand({ args: ["install"], taskId });

    expect(execaNodeForTask).toHaveBeenCalledTimes(1);

    const firstCall = vi.mocked(execaNodeForTask).mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("expected execaNodeForTask to have been called");
    }

    const [passedTaskId, pnpmBin, cliArgs, execaOpts, cwdArg] = firstCall as [
      typeof taskId,
      string,
      string[],
      { env?: Record<string, string> },
      unknown,
    ];

    expect(passedTaskId).toBe(taskId);
    expect(pnpmBin).toBe(getWorkspaceConfig().pnpmBinPath);
    expect(cliArgs).toEqual(["install"]);
    expect(execaOpts.env).toMatchObject({
      pnpm_config_reporter: "append-only",
    });
    expect(execaOpts.env).not.toHaveProperty("pnpm_config_loglevel");
    expect(cwdArg).toBeUndefined();
  });

  it("sets pnpm_config_loglevel=error when pnpmLogLevel is error", async () => {
    const { execaNodeForTask } = await import("./execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });

    const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
    await runPnpmCommand({
      args: ["dlx", "jiti@2.6.1", "x.ts"],
      pnpmLogLevel: "error",
      taskId,
    });

    expect(execaNodeForTask).toHaveBeenCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      ["dlx", "jiti@2.6.1", "x.ts"],
      expect.objectContaining({
        env: expect.objectContaining({
          pnpm_config_loglevel: "error",
          pnpm_config_reporter: "append-only",
        }),
      }),
      undefined,
    );
  });
});
