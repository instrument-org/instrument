import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("createPnpmCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createPnpmCommand(taskId);

  // The agent runs pnpm from `work/`; seed a manifest at the cwd so the manifest
  // guard passes. The dedicated guard test below uses a fresh, empty fs.
  beforeAll(async () => {
    await mockCtx.fs.writeFile("/package.json", "{}");
  });

  it("errors when run from a directory without a package manifest", async () => {
    const result = await command.execute(["add", "lodash"], {
      ...mockCtx,
      fs: new InMemoryFs(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Your project lives in `work/`");
  });

  it("strips global flags from the manifest guard suggestion", async () => {
    const result = await command.execute(["add", "--global", "lodash"], {
      ...mockCtx,
      fs: new InMemoryFs(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("`cd work && pnpm add lodash`");
  });

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

  it("refuses pnpm exec for a binary that is not installed locally", async () => {
    const result = await command.execute(
      ["exec", "node", "script.js"],
      mockCtx,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("was not found in node_modules/.bin");
  });

  it("refuses pnpm exec with no binary named", async () => {
    const result = await command.execute(["exec"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Name a locally-installed binary");
  });

  it("runs pnpm exec for a binary present in node_modules/.bin", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/package.json", "{}");
    await fs.writeFile("/node_modules/.bin/esbuild", "#!/bin/sh\n");

    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "0.28.1",
    });

    const result = await command.execute(["exec", "esbuild", "--version"], {
      ...mockCtx,
      fs,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.28.1");
    expect(vi.mocked(execaNodeForTask)).toHaveBeenLastCalledWith(
      taskId,
      getWorkspaceConfig().pnpmBinPath,
      ["exec", "esbuild", "--version"],
      expect.any(Object),
      expect.any(String),
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

  it("reports a failed auto-install on stderr, apart from the command's output", async () => {
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask)
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "ERR_PNPM_PEER_DEP_ISSUES",
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "script output" });

    const result = await command.execute(["run", "build"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("script output");
    expect(result.stderr).toMatchInlineSnapshot(`
      "[auto-install failed]
      ERR_PNPM_PEER_DEP_ISSUES

      "
    `);
  });

  it("does not auto-install for informational commands", async () => {
    const { execaNodeForTask } = await import("../execa-node-for-task");
    const execaNodeForTaskMock = vi.mocked(execaNodeForTask);
    execaNodeForTaskMock.mockClear();
    execaNodeForTaskMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "11.10.0",
    });

    const result = await command.execute(["--version"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("11.10.0");
    expect(execaNodeForTaskMock).toHaveBeenCalledOnce();
  });

  it("strips --global flag, runs command without it, and appends system note", async () => {
    const { execaNodeForTask } = await import("../execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "packages installed",
    });

    const result = await command.execute(
      ["add", "--global", "lodash"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("packages installed");
    expect(result.stderr).toMatchInlineSnapshot(`
      "
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
      exitCode: 0,
      stdout: "packages installed",
    });

    const result = await command.execute(["add", "-g", "lodash"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("packages installed");
    expect(result.stderr).toMatchInlineSnapshot(`
      "
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
      exitCode: 0,
      stdout: "1",
    });

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
        exitCode: 0,
        stdout: "hello",
      });

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
