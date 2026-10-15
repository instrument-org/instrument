import { describe, expect, it } from "vitest";

import {
  capNetworkIdleWait,
  NETWORK_IDLE_GAVE_UP,
  networkIdleWaitResult,
} from "./agent-browser-network-idle";

describe("capNetworkIdleWait", () => {
  it.each([
    {
      args: ["wait", "--load", "networkidle"],
      expected: ["wait", "--load", "networkidle", "--timeout", "5000"],
    },
    {
      args: ["wait", "-l", "networkidle"],
      expected: ["wait", "-l", "networkidle", "--timeout", "5000"],
    },
    {
      args: ["--json", "wait", "--load", "networkidle"],
      expected: [
        "--json",
        "wait",
        "--load",
        "networkidle",
        "--timeout",
        "5000",
      ],
    },
    // The agent's own timeout stands.
    {
      args: ["wait", "--load", "networkidle", "--timeout", "30000"],
      expected: ["wait", "--load", "networkidle", "--timeout", "30000"],
    },
    { args: ["wait", "--load", "load"], expected: ["wait", "--load", "load"] },
    {
      args: ["wait", "--text", "networkidle"],
      expected: ["wait", "--text", "networkidle"],
    },
    {
      args: ["diff", "url", "a", "b", "--wait-until", "networkidle"],
      expected: ["diff", "url", "a", "b", "--wait-until", "networkidle"],
    },
  ])("$args", ({ args, expected }) => {
    expect(capNetworkIdleWait(args)).toEqual(expected);
  });
});

describe("networkIdleWaitResult", () => {
  it("turns the capped wait's timeout into a loaded page with a busy network", () => {
    expect(
      networkIdleWaitResult({
        exitCode: 1,
        stderr:
          "✗ Operation timed out. The page may still be loading or the element may not exist.\n",
        stdout: "",
      }),
    ).toEqual({ exitCode: 0, stderr: "", stdout: NETWORK_IDLE_GAVE_UP });
  });

  it.each([
    { exitCode: 0, stderr: "", stdout: "✓ Done\n" },
    { exitCode: 1, stderr: "✗ Browser not launched\n", stdout: "" },
  ])("passes $stdout$stderr through", (result) => {
    expect(networkIdleWaitResult(result)).toBe(result);
  });
});
