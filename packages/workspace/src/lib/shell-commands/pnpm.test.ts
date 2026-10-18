import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

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

describe("createPnpmCommand", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
  const command = createPnpmCommand(chatId, chatLayout(chatId));

  it("adds a package in a folder with no manifest, where pnpm makes one", async () => {
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockClear();
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

  // `dev` and `start` were refused while the runtime was the only thing allowed
  // to serve an app. A long-running command is now a background process, so they
  // run like any other script.
  it.each([
    { args: ["dev"] },
    { args: ["start"] },
    { args: ["run", "dev"] },
    { args: ["run", "start"] },
  ])("runs pnpm $args instead of refusing it", async ({ args }) => {
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    // Two calls: the auto-install that precedes any non-package-management
    // subcommand, then the script itself.
    vi.mocked(execaNodeForChat).mockResolvedValue({
      exitCode: 0,
      stdout: "dev server listening",
    });

    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("dev server listening");
  });

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

    const { execaNodeForChat } = await import("../execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "0.28.1",
    });

    const result = await command.execute(["exec", "esbuild", "--version"], {
      ...mockCtx,
      fs,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.28.1");
    expect(vi.mocked(execaNodeForChat)).toHaveBeenLastCalledWith(
      chatId,
      getWorkspaceConfig().pnpmBinPath,
      ["exec", "esbuild", "--version"],
      expect.any(Object),
      expect.any(String),
      undefined,
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
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    vi.mocked(execaNodeForChat)
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "ERR_PNPM_PEER_DEP_ISSUES",
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "script output" });

    const result = await command.execute(["run", "build"], {
      ...mockCtx,
      fs: new InMemoryFs({ "/package.json": "{}" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("script output");
    expect(result.stderr).toMatchInlineSnapshot(`
      "[auto-install failed]
      ERR_PNPM_PEER_DEP_ISSUES

      "
    `);
  });

  it.each([
    { args: ["init"], manifest: false },
    { args: ["create", "vite", "app"], manifest: true },
    { args: ["run", "build"], manifest: false },
  ])(
    "runs pnpm $args with no auto-install first",
    async ({ args, manifest }) => {
      const { execaNodeForChat } = await import("../execa-node-for-chat");
      const execaNodeForChatMock = vi.mocked(execaNodeForChat);
      execaNodeForChatMock.mockClear();
      execaNodeForChatMock.mockResolvedValueOnce({ exitCode: 0, stdout: "" });

      const result = await command.execute(args, {
        ...mockCtx,
        fs: new InMemoryFs(manifest ? { "/package.json": "{}" } : {}),
      });

      expect(result.stderr).toBe("");
      expect(execaNodeForChatMock).toHaveBeenCalledOnce();
      expect(execaNodeForChatMock.mock.calls[0]?.[2]).toEqual(args);
    },
  );

  it("does not auto-install for informational commands", async () => {
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    const execaNodeForChatMock = vi.mocked(execaNodeForChat);
    execaNodeForChatMock.mockClear();
    execaNodeForChatMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "11.10.0",
    });

    const result = await command.execute(["--version"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("11.10.0");
    expect(execaNodeForChatMock).toHaveBeenCalledOnce();
  });

  it("strips --global flag, runs command without it, and appends system note", async () => {
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
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
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
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

  it("installs from the registry outside the sandbox when the plan allows it", async () => {
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    const { installOutside, outsidePlan } = await import("../pnpm-outside");
    vi.mocked(execaNodeForChat).mockClear();
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
    expect(vi.mocked(outsidePlan).mock.calls[0]?.[0].args).toEqual([
      "add",
      "is-odd",
    ]);
    expect(vi.mocked(installOutside).mock.calls[0]?.[0].plan).toBe(plan);
    expect(execaNodeForChat).not.toHaveBeenCalled();
  });

  it("runs the auto-install outside and the script in the sandbox", async () => {
    const { execaNodeForChat } = await import("../execa-node-for-chat");
    const { installOutside, outsidePlan } = await import("../pnpm-outside");
    vi.mocked(execaNodeForChat).mockClear();
    vi.mocked(installOutside).mockClear();
    const plan = { args: ["install", "--dir", "/"], project: "/" };
    vi.mocked(outsidePlan).mockImplementation(({ args }) =>
      args[0] === "install" ? plan : undefined,
    );
    vi.mocked(installOutside).mockResolvedValueOnce({
      command: "pnpm install",
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "built",
    });

    const result = await command.execute(["run", "build"], {
      ...mockCtx,
      fs: new InMemoryFs({ "/package.json": "{}" }),
    });

    expect(result.stdout).toBe("built");
    expect(vi.mocked(installOutside).mock.calls[0]?.[0].plan).toBe(plan);
    expect(
      vi.mocked(execaNodeForChat).mock.calls.map((call) => call[2]),
    ).toEqual([["run", "build"]]);
    vi.mocked(outsidePlan).mockReset();
  });

  it.each([["approve-builds", "esbuild"], ["rebuild"], ["rb"]])(
    "builds %s from the store its project was installed from",
    async (...args) => {
      const { execaNodeForChat } = await import("../execa-node-for-chat");
      const { installedProjectConfig } = await import("../pnpm-outside");
      vi.mocked(execaNodeForChat).mockClear();
      vi.mocked(installedProjectConfig).mockReturnValueOnce({
        pnpm_config_frozen_store: "true",
      });
      vi.mocked(execaNodeForChat).mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
      });

      await command.execute(args, mockCtx);

      expect(vi.mocked(execaNodeForChat).mock.calls[0]?.[3].env).toMatchObject({
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
      const { execaNodeForChat } = await import("../execa-node-for-chat");
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
      const { execaNodeForChat } = await import("../execa-node-for-chat");
      vi.mocked(execaNodeForChat).mockResolvedValueOnce({
        exitCode: 0,
        stdout: "hello",
      });

      const dlxCommand = createCommand(chatId, chatLayout(chatId));
      const result = await dlxCommand.execute(args, mockCtx);

      expect(result.exitCode).toBe(0);
      expect(vi.mocked(execaNodeForChat)).toHaveBeenLastCalledWith(
        chatId,
        getWorkspaceConfig().pnpmBinPath,
        expectedArgs,
        expect.any(Object),
        expect.any(String),
        undefined,
      );
    },
  );
});
