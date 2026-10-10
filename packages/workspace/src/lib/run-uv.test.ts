import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { runUvCommand } from "./run-uv";

vi.mock("execa");

describe("runUvCommand", () => {
  it("returns a spawn diagnostic when uv is unavailable", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: undefined,
      shortMessage: "Command failed with ENOENT: uv --version",
      stdout: "",
    } as never);

    const taskId = createMockChatConfig(ChatIdSchema.parse("missing-uv"));
    const result = await runUvCommand({ args: ["--version"], taskId });

    expect(result).toMatchObject({
      combined: "Command failed with ENOENT: uv --version",
      exitCode: 1,
    });
  });
});
