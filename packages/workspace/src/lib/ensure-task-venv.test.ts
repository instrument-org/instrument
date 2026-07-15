import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { ensureTaskVenvForTask } from "./ensure-task-venv";

vi.mock(import("./run-uv"));

describe("ensureTaskVenvForTask", () => {
  it("shares concurrent venv creation for the same task", async () => {
    const { runUvCommand } = await import("./run-uv");
    let complete: (() => void) | undefined;
    vi.mocked(runUvCommand).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = () => {
            resolve({ combined: "", exitCode: 0, stdout: "" });
          };
        }),
    );

    const taskId = createMockTaskConfig(TaskIdSchema.parse("venv-race"));
    const first = ensureTaskVenvForTask({ taskId });
    const second = ensureTaskVenvForTask({ taskId });

    expect(runUvCommand).toHaveBeenCalledTimes(1);
    expect(complete).toBeDefined();
    complete?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });
});
