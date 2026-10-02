import { describe, expect, it } from "vitest";

import { isFailedBashExitCode } from "./bash-exit-status";

describe("isFailedBashExitCode", () => {
  it.each([
    { exitCode: undefined, failed: false },
    { exitCode: 0, failed: false },
    { exitCode: 1, failed: true },
  ])("reports $exitCode as failed=$failed", ({ exitCode, failed }) => {
    expect(isFailedBashExitCode(exitCode)).toBe(failed);
  });
});
