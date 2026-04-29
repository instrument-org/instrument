import { describe, expect, it, vi } from "vitest";

import { ProjectSubdomainSchema } from "../schemas/subdomains";
import { createMockAppConfig } from "../test/helpers/mock-app-config";
import { runPnpmCommand } from "./run-pnpm";

vi.mock(import("./execa-node-for-app"));

describe("runPnpmCommand", () => {
  it("sets npm_config_reporter=append-only on the child process env", async () => {
    const { execaNodeForApp } = await import("./execa-node-for-app");
    vi.mocked(execaNodeForApp).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    } as never);

    const appConfig = createMockAppConfig(ProjectSubdomainSchema.parse("test"));
    await runPnpmCommand({ appConfig, args: ["install"] });

    expect(execaNodeForApp).toHaveBeenCalledTimes(1);

    const firstCall = vi.mocked(execaNodeForApp).mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("expected execaNodeForApp to have been called");
    }

    const [passedApp, pnpmBin, cliArgs, execaOpts, cwdArg] = firstCall as [
      typeof appConfig,
      string,
      string[],
      { env?: Record<string, string> },
      unknown,
    ];

    expect(passedApp).toBe(appConfig);
    expect(pnpmBin).toBe(appConfig.workspaceConfig.pnpmBinPath);
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

    const appConfig = createMockAppConfig(ProjectSubdomainSchema.parse("test"));
    await runPnpmCommand({
      appConfig,
      args: ["dlx", "jiti@2.6.1", "x.ts"],
      pnpmLogLevel: "error",
    });

    expect(execaNodeForApp).toHaveBeenCalledWith(
      appConfig,
      appConfig.workspaceConfig.pnpmBinPath,
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
