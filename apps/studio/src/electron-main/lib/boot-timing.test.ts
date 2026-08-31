import { beforeEach, describe, expect, it, vi } from "vitest";

import { timeBootStep } from "./boot-timing";

const { log } = vi.hoisted(() => ({
  log: { info: vi.fn() },
}));

vi.mock("./electron-logger", () => ({
  logger: { scope: () => log },
}));

describe("timeBootStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the step's value and logs its duration", async () => {
    await expect(timeBootStep("runMigrations", () => "done")).resolves.toBe(
      "done",
    );

    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/^runMigrations: \d+ms$/),
    );
  });

  it("rejects with the step's name attached, keeping the throw as the cause", async () => {
    const inner = new Error("db locked");

    await expect(
      timeBootStep("createWorkspaceActor", () => {
        throw inner;
      }),
    ).rejects.toMatchObject({
      cause: inner,
      message: "Boot failed during createWorkspaceActor",
    });

    // The duration line is the trace a support report gets, so a failing step
    // still leaves one.
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/^createWorkspaceActor: \d+ms$/),
    );
  });
});
