import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
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

    const taskId = createMockTaskConfig(TaskIdSchema.parse("missing-uv"));
    const result = await runUvCommand({ args: ["--version"], taskId });

    expect(result).toMatchObject({
      combined: "Command failed with ENOENT: uv --version",
      exitCode: 1,
    });
  });
});
