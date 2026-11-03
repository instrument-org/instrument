import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { execaNodeForChat } from "./execa-node-for-chat";
import { runPnpmCommand } from "./run-pnpm";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock(import("./execa-node-for-chat"));

beforeEach(() => {
  vi.mocked(execaNodeForChat).mockResolvedValue({ all: "", exitCode: 0 });
});

describe("runPnpmCommand", () => {
  it("runs the app's pnpm with the args and the append-only reporter", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
    await runPnpmCommand({ args: ["install"], chatId });

    const [passedChatId, pnpmBin, cliArgs, execaOpts] =
      vi.mocked(execaNodeForChat).mock.lastCall ?? [];
    expect(passedChatId).toBe(chatId);
    expect(pnpmBin).toBe(getWorkspaceConfig().pnpmBinPath);
    expect(cliArgs).toEqual(["install"]);
    expect(execaOpts?.env).toMatchObject({
      pnpm_config_reporter: "append-only",
    });
    expect(execaOpts?.env).not.toHaveProperty("pnpm_config_loglevel");
  });

  it("sets pnpm_config_loglevel=error when pnpmLogLevel is error", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
    await runPnpmCommand({ args: ["dlx", "x"], pnpmLogLevel: "error", chatId });

    expect(vi.mocked(execaNodeForChat).mock.lastCall?.[3].env).toMatchObject({
      pnpm_config_loglevel: "error",
    });
  });

  it("holds pnpm outside a shell call to the chat's reach", async () => {
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
