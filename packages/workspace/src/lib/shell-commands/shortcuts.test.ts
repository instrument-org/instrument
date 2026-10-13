import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { taskLayout } from "../../test/helpers/task-layout";
import { createShortcutsCommand } from "./shortcuts";

vi.mock("execa");

describe("shortcuts", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("shortcuts-test"));
  const layout = taskLayout(chatId);
  const command = createShortcutsCommand(chatId, layout);
  const ctx = createCommandContext({
    cwd: layout.task.shellRoot,
    env: new Map<string, string>(),
    fs: new InMemoryFs(),
    stdin: EMPTY_BYTES,
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("lists the user's shortcuts with the system command", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "Morning",
      exitCode: 0,
    } as never);

    const result = await command.execute(["list"], ctx);

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/shortcuts",
      ["list"],
      expect.anything(),
    );
  });

  it("passes a run's output path through unchanged", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);

    await command.execute(
      ["run", "Resize", "-o", `${layout.task.shellRoot}/out.png`],
      ctx,
    );

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/shortcuts",
      ["run", "Resize", "-o", `${layout.task.shellRoot}/out.png`],
      expect.anything(),
    );
  });

  it.each([["view", "Morning"], ["sign", "-i", "a"], []])(
    "refuses %j",
    async (...args) => {
      const result = await command.execute(args, ctx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("takes list or run");
    },
  );
});
