import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { runPnpmCommand } from "./run-pnpm";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock(import("./execa-node-for-chat"));

describe("runPnpmCommand", () => {
  it("sets pnpm_config_reporter=append-only on the child process env", async () => {
    const { execaNodeForChat } = await import("./execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
    await runPnpmCommand({
      args: ["install"],
      chatId,
    });

    expect(execaNodeForChat).toHaveBeenCalledTimes(1);

    const firstCall = vi.mocked(execaNodeForChat).mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("expected execaNodeForChat to have been called");
    }

    const [passedChatId, pnpmBin, cliArgs, execaOpts, cwdArg] = firstCall;

    expect(passedChatId).toBe(chatId);
    expect(pnpmBin).toBe(getWorkspaceConfig().pnpmBinPath);
    expect(cliArgs).toEqual(["install"]);
    expect(execaOpts.env).toMatchObject({
      pnpm_config_reporter: "append-only",
    });
    expect(execaOpts.env).not.toHaveProperty("pnpm_config_loglevel");
    expect(cwdArg).toBeUndefined();
  });

  it("sets pnpm_config_loglevel=error when pnpmLogLevel is error", async () => {
    const { execaNodeForChat } = await import("./execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
    await runPnpmCommand({
      args: ["dlx", "jiti@2.6.1", "x.ts"],
      pnpmLogLevel: "error",
      chatId,
    });

    expect(execaNodeForChat).toHaveBeenCalledWith(
      chatId,
      getWorkspaceConfig().pnpmBinPath,
      ["dlx", "jiti@2.6.1", "x.ts"],
      expect.objectContaining({
        env: expect.objectContaining({
          pnpm_config_loglevel: "error",
          pnpm_config_reporter: "append-only",
        }),
      }),
      undefined,
      undefined,
    );
  });

  it("holds pnpm outside a shell call to the chat's reach", async () => {
    const { execaNodeForChat } = await import("./execa-node-for-chat");
    vi.mocked(execaNodeForChat).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });
    const chatId = createMockChatConfig(ChatIdSchema.parse("skill-install"));
    const config = getWorkspaceConfig();
    setWorkspaceConfig({ ...config, nativeSandbox: true });
    try {
      await runPnpmCommand({ args: ["install"], chatId });
      const reach = vi.mocked(execaNodeForChat).mock.lastCall?.[5];
      expect(reach?.readWrite).toContain(workDir(chatId));
    } finally {
      setWorkspaceConfig(config);
    }
  });
});
