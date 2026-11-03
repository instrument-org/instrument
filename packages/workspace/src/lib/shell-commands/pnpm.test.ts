import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import {
  createNpxCommand,
  createPnpmCommand,
  createPnpxCommand,
  createPnxCommand,
  PNPM_COMMAND,
} from "./pnpm";
import { chatLayout } from "../../test/helpers/chat-layout";
import { execaNodeForChat } from "../execa-node-for-chat";
import {
  installedProjectConfig,
  installOutside,
  outsidePlan,
} from "../pnpm-outside";

vi.mock(import("../execa-node-for-chat"));
vi.mock(import("../pnpm-outside"), async (importOriginal) => ({
  ...(await importOriginal()),
  installedProjectConfig: vi.fn(),
  installOutside: vi.fn(),
  outsidePlan: vi.fn(),
}));

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

beforeEach(() => {});

/** The args the last pnpm run inside the sandbox was given. */
const lastPnpmArgs = () => vi.mocked(execaNodeForChat).mock.lastCall?.[2];

describe("createPnpmCommand", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const command = createPnpmCommand(chatId, chatLayout(chatId));

  it("adds a package in a folder with no manifest, where pnpm makes one", async () => {
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "+ lodash 4.17.21",
    });

    // The folder as this computer spells it, where pnpm runs, and as the
    // shell does, which differs on Windows.
    const job = path.resolve("/job");
    const result = await command.execute(["add", "lodash"], {
      ...mockCtx,
      cwd: shellPath(job),
      fs: new InMemoryFs({ [`${shellPath(job)}/notes.md`]: "" }),
    });

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execaNodeForChat)).toHaveBeenCalledOnce();
    expect(vi.mocked(execaNodeForChat)).toHaveBeenLastCalledWith(
      chatId,
      getWorkspaceConfig().pnpmBinPath,
      ["add", "lodash"],
      expect.any(Object),
      job,
      undefined,
    );
  });

  it("passes pnpm exec through whole, its -g included", async () => {
    const fs = new InMemoryFs({ "/package.json": "{}" });

    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "0.28.1",
    });

    const result = await command.execute(["exec", "esbuild", "-g"], {
      ...mockCtx,
      fs,
    });

    expect(result.stdout).toBe("0.28.1");
    expect(result.stderr).toBe("");
    expect(lastPnpmArgs()).toEqual(["exec", "esbuild", "-g"]);
  });

  it.each([{ subcommand: "setup" }, { subcommand: "env" }])(
    "errors when trying to run pnpm $subcommand",
    async ({ subcommand }) => {
      const result = await command.execute([subcommand], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `'${PNPM_COMMAND.name} ${subcommand}' is not allowed`,
      );
    },
  );

  it.each([["run", "build"], ["dev"], ["store", "path"]])(
    "runs pnpm %s as it is, with nothing run first",
    async (...args) => {
      const execaNodeForChatMock = vi.mocked(execaNodeForChat);
      execaNodeForChatMock.mockResolvedValueOnce({ exitCode: 0, stdout: "" });

      const result = await command.execute(args, {
        ...mockCtx,
        fs: new InMemoryFs({ "/package.json": "{}" }),
      });

      expect(result.stderr).toBe("");
      expect(execaNodeForChatMock).toHaveBeenCalledOnce();
      expect(lastPnpmArgs()).toEqual(args);
    },
  );

  it.each(["--global", "-g"])(
    "runs pnpm add without %s and says the flag was stripped",
    async (flag) => {
      vi.mocked(execaNodeForChat).mockResolvedValueOnce({
        exitCode: 0,
        stdout: "packages installed",
      });

      const result = await command.execute(["add", flag, "lodash"], mockCtx);

      expect(lastPnpmArgs()).toEqual(["add", "lodash"]);
      expect(result.stdout).toBe("packages installed");
      expect(result.stderr).toContain("The --global / -g flag was stripped.");
    },
  );

  it("installs from the registry outside the sandbox when the plan allows it", async () => {
    const plan = { args: ["add", "is-odd", "--dir", "/job"], project: "/job" };
    vi.mocked(outsidePlan).mockReturnValueOnce(plan);
    vi.mocked(installOutside).mockResolvedValueOnce({
      command: "pnpm add is-odd",
      exitCode: 0,
      stderr: "",
      stdout: "+ is-odd 3.0.1",
    });

    const result = await command.execute(["add", "is-odd"], mockCtx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "+ is-odd 3.0.1",
    });
    expect(vi.mocked(outsidePlan).mock.lastCall?.[0].args).toEqual([
      "add",
      "is-odd",
    ]);
    expect(vi.mocked(installOutside).mock.lastCall?.[0].plan).toBe(plan);
    expect(execaNodeForChat).not.toHaveBeenCalled();
  });

  it.each([["approve-builds", "esbuild"], ["rb"]])(
    "builds %s from the store its project was installed from",
    async (...args) => {
      vi.mocked(installedProjectConfig).mockReturnValueOnce({
        pnpm_config_frozen_store: "true",
      });
      vi.mocked(execaNodeForChat).mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
      });

      await command.execute(args, mockCtx);

      expect(vi.mocked(execaNodeForChat).mock.lastCall?.[3].env).toMatchObject({
        pnpm_config_frozen_store: "true",
      });
    },
  );

  it.each([
    { args: ["add", "file:../lib"], noted: true },
    { args: ["run", "build"], noted: false },
  ])(
    "says which installs work when the sandbox refuses links ($args)",
    async ({ args, noted }) => {
      vi.mocked(execaNodeForChat).mockResolvedValueOnce({
        exitCode: 1,
        stderr: "[EPERM] EPERM: operation not permitted, symlink 'a' -> 'b'",
        stdout: "",
      });

      const result = await command.execute(args, mockCtx);

      expect(result.exitCode).toBe(1);
      expect(
        result.stderr.includes("Only installs of npm registry packages work"),
      ).toBe(noted);
    },
  );

  it("aliases npx registered commands to the bash command registry", async () => {
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: "1\n",
    });

    const npxCommand = createNpxCommand(chatId, chatLayout(chatId));
    const result = await npxCommand.execute(
      ["-y", "node", "-e", "console.log(1)"],
      {
        ...mockCtx,
        exec,
        getRegisteredCommands: () => ["pnpm", "npx", "pnpx", "pnx", "node"],
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "1\n",
    });
    expect(exec).toHaveBeenCalledWith("node", {
      args: ["-e", "console.log(1)"],
      cwd: "/",
      signal: undefined,
      stdin: EMPTY_BYTES,
    });
  });

  it.each([
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
      vi.mocked(execaNodeForChat).mockResolvedValueOnce({
        exitCode: 0,
        stdout: "hello",
      });

      const dlxCommand = createCommand(chatId, chatLayout(chatId));
      const result = await dlxCommand.execute(args, mockCtx);

      expect(result.stdout).toBe("hello");
      expect(lastPnpmArgs()).toEqual(expectedArgs);
    },
  );
});
