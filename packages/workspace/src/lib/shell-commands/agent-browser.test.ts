import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { createAgentBrowserCommand } from "./agent-browser";

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
};

describe("createAgentBrowserCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createAgentBrowserCommand({
    sessionId: StoreId.newSessionId(),
    taskId,
  });

  it("returns managed help with read guidance", async () => {
    const result = await command.execute(["--help"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agent-browser read");
    expect(result.stdout).toContain(
      "Read the active page as agent-friendly text",
    );
    expect(result.stdout).toContain("restore");
  });

  it.each([
    { flag: "--config" },
    { flag: "--namespace" },
    { flag: "--restore" },
    { flag: "--restore-save" },
    { flag: "--session-name" },
  ])("blocks workspace-managed flag $flag", async ({ flag }) => {
    const result = await command.execute([flag, "value", "open"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`flag ${flag} is not allowed`);
  });

  it.each([
    { subcommand: "connect" },
    { subcommand: "install" },
    { subcommand: "mcp" },
    { subcommand: "plugin" },
    { subcommand: "session" },
  ])(
    "blocks workspace-managed subcommand $subcommand",
    async ({ subcommand }) => {
      const result = await command.execute([subcommand], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `subcommand '${subcommand}' is not available`,
      );
    },
  );
});
