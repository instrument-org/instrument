import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { taskLayout } from "../../test/helpers/task-layout";
import { taskDir } from "../task-dir-utils";
import { createShortcutsCommand } from "./shortcuts";

vi.mock("execa");

const ctx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("shortcuts", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("shortcuts-test"));
  const command = createShortcutsCommand(taskId, taskLayout(taskId));

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

  it("writes a run's result into the task folder", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);

    await command.execute(["run", "Resize", "-o", "/task/out.png"], ctx);

    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/shortcuts",
      ["run", "Resize", "-o", path.join(taskDir(taskId), "out.png")],
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
