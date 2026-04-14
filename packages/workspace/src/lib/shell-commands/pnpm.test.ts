import { type CommandContext, InMemoryFs } from "just-bash";
import { describe, expect, it, vi } from "vitest";

import { ProjectSubdomainSchema } from "../../schemas/subdomains";
import { createMockAppConfig } from "../../test/helpers/mock-app-config";
import { createPnpmCommand, PNPM_COMMAND } from "./pnpm";

vi.mock(import("../execa-node-for-app"));

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: "",
};

describe("createPnpmCommand", () => {
  const appConfig = createMockAppConfig(ProjectSubdomainSchema.parse("test"));
  const command = createPnpmCommand(appConfig);

  it.each([{ subcommand: "dev" }, { subcommand: "start" }])(
    "errors when trying to run pnpm $subcommand",
    async ({ subcommand }) => {
      const result = await command.execute([subcommand], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `'${PNPM_COMMAND.name} ${subcommand}' is not needed here`,
      );
    },
  );

  it.each([{ subcommand: "dev" }, { subcommand: "start" }])(
    "errors when trying to run pnpm run $subcommand",
    async ({ subcommand }) => {
      const result = await command.execute(["run", subcommand], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `'${PNPM_COMMAND.name} run ${subcommand}' is not needed here`,
      );
    },
  );

  it("errors when trying to run pnpm exec", async () => {
    const result = await command.execute(
      ["exec", "node", "script.js"],
      mockCtx,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `'${PNPM_COMMAND.name} exec' is not allowed`,
    );
  });

  it.each([
    { subcommand: "setup" },
    { subcommand: "env" },
    { subcommand: "store" },
    { subcommand: "publish" },
    { subcommand: "pack" },
  ])("errors when trying to run pnpm $subcommand", async ({ subcommand }) => {
    const result = await command.execute([subcommand], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `'${PNPM_COMMAND.name} ${subcommand}' is not allowed`,
    );
  });

  it("includes auto-install output in stdout when install fails", async () => {
    const { execaNodeForApp } = await import("../execa-node-for-app");
    vi.mocked(execaNodeForApp)
      .mockResolvedValueOnce({
        all: "ERR_PNPM_PEER_DEP_ISSUES",
        exitCode: 1,
      } as never)
      .mockResolvedValueOnce({ all: "script output", exitCode: 0 } as never);

    const result = await command.execute(["run", "build"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "[auto-install failed]
      ERR_PNPM_PEER_DEP_ISSUES

      script output"
    `);
  });

  it("strips --global flag, runs command without it, and appends system note", async () => {
    const { execaNodeForApp } = await import("../execa-node-for-app");
    vi.mocked(execaNodeForApp).mockResolvedValueOnce({
      all: "packages installed",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      ["add", "--global", "lodash"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "packages installed
      <instrument-system-note>
      The --global / -g flag was stripped. Global installs are not supported in this environment.
      Packages must be installed locally with \`pnpm add <package>\`.
      The command was re-run without the flag.
      </instrument-system-note>"
    `);
  });

  it("strips -g flag, runs command without it, and appends system note", async () => {
    const { execaNodeForApp } = await import("../execa-node-for-app");
    vi.mocked(execaNodeForApp).mockResolvedValueOnce({
      all: "packages installed",
      exitCode: 0,
    } as never);

    const result = await command.execute(["add", "-g", "lodash"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "packages installed
      <instrument-system-note>
      The --global / -g flag was stripped. Global installs are not supported in this environment.
      Packages must be installed locally with \`pnpm add <package>\`.
      The command was re-run without the flag.
      </instrument-system-note>"
    `);
  });

  it.each([
    { args: ["tsx", "-e", "console.log(1)"], form: "pnpm tsx -e ..." },
    {
      args: ["exec", "tsx", "-e", "console.log(1)"],
      form: "pnpm exec tsx -e ...",
    },
  ])("forwards $form to the ts command", async ({ args }) => {
    const { execaNodeForApp } = await import("../execa-node-for-app");
    vi.mocked(execaNodeForApp).mockResolvedValueOnce({
      all: "1",
      exitCode: 0,
    } as never);

    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execaNodeForApp)).toHaveBeenCalledWith(
      appConfig,
      appConfig.workspaceConfig.pnpmBinPath,
      expect.arrayContaining(["dlx", "jiti"]),
      expect.any(Object),
      expect.any(String),
    );
  });
});
