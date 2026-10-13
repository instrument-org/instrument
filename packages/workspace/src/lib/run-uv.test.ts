import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { wrapNativeCommand } from "./native-sandbox";
import { runUvCommand } from "./run-uv";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock("execa");
vi.mock(import("./native-sandbox"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, wrapNativeCommand: vi.fn(actual.wrapNativeCommand) };
});

describe("runUvCommand", () => {
  it("returns a spawn diagnostic when uv is unavailable", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: undefined,
      shortMessage: "Command failed with ENOENT: uv --version",
      stdout: "",
    } as never);

    const chatId = createMockChatConfig(ChatIdSchema.parse("missing-uv"));
    const result = await runUvCommand({ args: ["--version"], chatId });

    expect(result).toMatchObject({
      combined: "Command failed with ENOENT: uv --version",
      exitCode: 1,
    });
  });

  it("holds uv to the chat's reach", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
      stdout: "",
    } as never);
    const chatId = createMockChatConfig(ChatIdSchema.parse("uv-reach"));
    const config = getWorkspaceConfig();
    setWorkspaceConfig({ ...config, nativeSandbox: true });
    try {
      await runUvCommand({ args: ["pip", "list"], chatId });
    } finally {
      setWorkspaceConfig(config);
    }
    const reach = vi.mocked(wrapNativeCommand).mock.lastCall?.[2];
    expect(reach?.readWrite).toContain(workDir(chatId));
  });
});
