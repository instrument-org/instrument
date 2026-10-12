import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { runPnpmCommand } from "./run-pnpm";
import { getWorkspaceConfig } from "./workspace-config";
import { taskLayout } from "../test/helpers/task-layout";

vi.mock(import("./execa-node-for-task"));

describe("runPnpmCommand", () => {
  it("sets pnpm_config_reporter=append-only on the child process env", async () => {
    const { execaNodeForTask } = await import("./execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
    await runPnpmCommand({
      args: ["install"],
      layout: taskLayout(chatId),
      chatId,
    });

    expect(execaNodeForTask).toHaveBeenCalledTimes(1);

    const firstCall = vi.mocked(execaNodeForTask).mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) {
      throw new Error("expected execaNodeForTask to have been called");
    }

    const [passedChatId, pnpmBin, cliArgs, execaOpts, cwdArg] = firstCall as [
      typeof chatId,
      string,
      string[],
      { env?: Record<string, string> },
      unknown,
    ];

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
    const { execaNodeForTask } = await import("./execa-node-for-task");
    vi.mocked(execaNodeForTask).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("test"));
    await runPnpmCommand({
      args: ["dlx", "jiti@2.6.1", "x.ts"],
      layout: taskLayout(chatId),
      pnpmLogLevel: "error",
      chatId,
    });

    expect(execaNodeForTask).toHaveBeenCalledWith(
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
    );
  });
});
