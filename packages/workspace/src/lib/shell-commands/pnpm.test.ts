import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig } from "../workspace-config";
import {
  createNpxCommand,
  createPnpmCommand,
  createPnpxCommand,
  createPnxCommand,
  PNPM_COMMAND,
} from "./pnpm";

vi.mock(import("../execa-node-for-task"));

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
};

describe("createPnpmCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createPnpmCommand(taskId);

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
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask)
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
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
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
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
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
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "1",
      exitCode: 0,
    } as never);

    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execaNodeForTask)).toHaveBeenCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      expect.arrayContaining(["dlx", "jiti@2.6.1"]),
      expect.any(Object),
      expect.any(String),
    );
  });

  it("aliases npx registered commands to the bash command registry", async () => {
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: "1\n",
    });

    const npxCommand = createNpxCommand(taskId);
    const result = await npxCommand.execute(
      ["-y", "tsx", "-e", "console.log(1)"],
      {
        ...mockCtx,
        exec,
        getRegisteredCommands: () => ["pnpm", "npx", "pnpx", "pnx", "tsx"],
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "1\n",
    });
    expect(exec).toHaveBeenCalledWith("tsx", {
      args: ["-e", "console.log(1)"],
      cwd: "/",
      signal: undefined,
      stdin: EMPTY_BYTES,
    });
  });

  it.each([
    {
      // cspell:ignore cowsay
      args: ["cowsay", "hello"],
      createCommand: createNpxCommand,
      expectedArgs: ["dlx", "cowsay", "hello"],
      name: "npx",
    },
    {
      args: ["cowsay", "hello"],
      createCommand: createPnpxCommand,
      expectedArgs: ["dlx", "cowsay", "hello"],
      name: "pnpx",
    },
    {
      args: ["cowsay", "hello"],
      createCommand: createPnxCommand,
      expectedArgs: ["dlx", "cowsay", "hello"],
      name: "pnx",
    },
    {
      args: ["--yes", "cowsay", "hello"],
      createCommand: createNpxCommand,
      expectedArgs: ["dlx", "cowsay", "hello"],
      name: "npx --yes",
    },
  ])(
    "runs $name through pnpm dlx",
    async ({ args, createCommand, expectedArgs }) => {
      const { execaNodeForTask } = await import("../execa-node-for-task");
      vi.mocked(execaNodeForTask).mockResolvedValueOnce({
        all: "hello",
        exitCode: 0,
      } as never);

      const dlxCommand = createCommand(taskId);
      const result = await dlxCommand.execute(args, mockCtx);

      expect(result.exitCode).toBe(0);
      expect(vi.mocked(execaNodeForTask)).toHaveBeenLastCalledWith(
        taskId,
        getWorkspaceConfig().pnpmBinPath,
        expectedArgs,
        expect.any(Object),
        expect.any(String),
      );
    },
  );
});
