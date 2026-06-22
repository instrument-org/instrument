import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockAppConfig } from "../test/helpers/mock-app-config";
import { runPnpmCommand } from "./run-pnpm";
import { getWorkspaceConfig } from "./workspace-config";

vi.mock(import("./execa-node-for-app"));

describe("runPnpmCommand", () => {
  it("sets npm_config_reporter=append-only on the child process env", async () => {
    const { execaNodeForApp } = await import("./execa-node-for-app");
    vi.mocked(execaNodeForApp).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const taskId = createMockAppConfig(TaskIdSchema.parse("test"));
    await runPnpmCommand({ args: ["install"], taskId });

    expect(execaNodeForApp).toHaveBeenCalledTimes(1);

    const firstCall = vi.mocked(execaNodeForApp).mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("expected execaNodeForApp to have been called");
    }

    const [passedApp, pnpmBin, cliArgs, execaOpts, cwdArg] = firstCall as [
      typeof taskId,
      string,
      string[],
      { env?: Record<string, string> },
      unknown,
    ];

    expect(passedApp).toBe(taskId);
    expect(pnpmBin).toBe(getWorkspaceConfig().pnpmBinPath);
    expect(cliArgs).toEqual(["install"]);
    expect(execaOpts.env).toMatchObject({
      npm_config_reporter: "append-only",
    });
    expect(execaOpts.env).not.toHaveProperty("npm_config_loglevel");
    expect(cwdArg).toBeUndefined();
  });

  it("sets npm_config_loglevel=error when pnpmLogLevel is error", async () => {
    const { execaNodeForApp } = await import("./execa-node-for-app");
    vi.mocked(execaNodeForApp).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const taskId = createMockAppConfig(TaskIdSchema.parse("test"));
    await runPnpmCommand({
      args: ["dlx", "jiti@2.6.1", "x.ts"],
      pnpmLogLevel: "error",
      taskId,
    });

    expect(execaNodeForApp).toHaveBeenCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      ["dlx", "jiti@2.6.1", "x.ts"],
      expect.objectContaining({
        env: expect.objectContaining({
          npm_config_loglevel: "error",
          npm_config_reporter: "append-only",
        }),
      }),
      undefined,
    );
  });
});
