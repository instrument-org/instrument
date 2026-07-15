import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { ensureTaskVenvForTask } from "./ensure-task-venv";

vi.mock(import("./run-uv"));

describe("ensureTaskVenvForTask", () => {
  it("lets one caller cancel without cancelling shared venv creation", async () => {
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
    const firstSignal = new AbortController();
    const secondSignal = new AbortController();
    const first = ensureTaskVenvForTask({
      signal: firstSignal.signal,
      taskId,
    });
    const second = ensureTaskVenvForTask({
      signal: secondSignal.signal,
      taskId,
    });

    expect(runUvCommand).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(runUvCommand).mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0].signal).toBeUndefined();

    firstSignal.abort();
    await expect(first).resolves.toEqual({
      exitCode: 1,
      output: "Python environment setup was cancelled.",
    });

    expect(complete).toBeDefined();
    complete?.();

    await expect(second).resolves.toBeUndefined();
  });
});
