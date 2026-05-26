import { describe, expect, it } from "vitest";

import {
  allowQuitWithoutRunningAgentsWarning,
  shouldSkipRunningAgentsQuitWarning,
} from "./quit-with-running-agents";

describe("quit-with-running-agents", () => {
  it("skips the warning after allowQuitWithoutRunningAgentsWarning", () => {
    expect(shouldSkipRunningAgentsQuitWarning()).toBe(false);
    allowQuitWithoutRunningAgentsWarning();
    expect(shouldSkipRunningAgentsQuitWarning()).toBe(true);
  });
});
