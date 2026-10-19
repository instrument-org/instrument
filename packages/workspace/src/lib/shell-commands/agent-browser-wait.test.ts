import { describe, expect, it } from "vitest";

import {
  cappedWaitResult,
  capWait,
  NETWORK_IDLE_GAVE_UP,
  namedWaitGaveUp,
  uncappedWait,
} from "./agent-browser-wait";

const capped = (args: string[]) => capWait(args, uncappedWait(args));

describe("capWait", () => {
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
    {
      args: ["wait", "--text", "Added to Cart"],
      expected: ["wait", "--text", "Added to Cart", "--timeout", "10000"],
    },
    {
      args: ["wait", "-t", "networkidle"],
      expected: ["wait", "-t", "networkidle", "--timeout", "10000"],
    },
    {
      args: ["wait", "--url", "**/wiki/MOSFET"],
      expected: ["wait", "--url", "**/wiki/MOSFET", "--timeout", "10000"],
    },
    {
      args: ["--session", "s1", "wait", "-u", "**/search?q=*"],
      expected: [
        "--session",
        "s1",
        "wait",
        "-u",
        "**/search?q=*",
        "--timeout",
        "10000",
      ],
    },
    {
      args: ["wait", "#results"],
      expected: ["wait", "#results", "--timeout", "10000"],
    },
    {
      args: ["wait", "#spinner", "--state", "hidden"],
      expected: ["wait", "#spinner", "--state", "hidden", "--timeout", "10000"],
    },
    // The agent's own timeout stands, wherever it put it.
    {
      args: ["wait", "--load", "networkidle", "--timeout", "30000"],
      expected: ["wait", "--load", "networkidle", "--timeout", "30000"],
    },
    {
      args: ["wait", "--timeout", "30000", "--text", "Integrations"],
      expected: ["wait", "--timeout", "30000", "--text", "Integrations"],
    },
    {
      args: ["wait", "--url", "**/checkout", "--timeout", "60000"],
      expected: ["wait", "--url", "**/checkout", "--timeout", "60000"],
    },
    {
      args: ["wait", "@e5", "--timeout", "2000"],
      expected: ["wait", "@e5", "--timeout", "2000"],
    },
    // Waits the harness leaves alone.
    {
      args: ["wait", "--fn", "document.body.dataset.ready"],
      expected: ["wait", "--fn", "document.body.dataset.ready"],
    },
    { args: ["wait", "2000"], expected: ["wait", "2000"] },
    { args: ["wait", "--load", "load"], expected: ["wait", "--load", "load"] },
    {
      args: ["wait", "--download", "report.pdf"],
      expected: ["wait", "--download", "report.pdf"],
    },
    { args: ["wait", "--text"], expected: ["wait", "--text"] },
    { args: ["wait"], expected: ["wait"] },
    { args: ["click", "#results"], expected: ["click", "#results"] },
    {
      args: ["diff", "url", "a", "b", "--wait-until", "networkidle"],
      expected: ["diff", "url", "a", "b", "--wait-until", "networkidle"],
    },
  ])("$args", ({ args, expected }) => {
    expect(capped(args)).toEqual(expected);
  });

  // Upstream reads `--url` before `--load`, so this waits for the address.
  it("caps a wait the way upstream reads it", () => {
    expect(
      uncappedWait(["wait", "--load", "networkidle", "--url", "**/a"]),
    ).toEqual({ condition: "**/a", kind: "url" });
  });
});

describe("namedWaitGaveUp", () => {
  it("names what never came and what to do next", () => {
    expect([
      namedWaitGaveUp({ condition: "Added to Cart", kind: "text" }),
      namedWaitGaveUp({ condition: "**/wiki/MOSFET", kind: "url" }),
      namedWaitGaveUp({
        condition: "#results",
        kind: "selector",
        state: undefined,
      }),
      namedWaitGaveUp({
        condition: "#spinner",
        kind: "selector",
        state: "hidden",
      }),
    ]).toMatchInlineSnapshot(`
      [
        "The text "Added to Cart" did not appear within 10 seconds, so the last step may not have done what you expected. Take a snapshot to see what the page shows now, and check the text you waited for. If the page is only slow, wait again with a longer \`--timeout\`, such as \`--timeout 30000\`.
      ",
        "The page address did not match "**/wiki/MOSFET" within 10 seconds, so the last step may not have done what you expected. Take a snapshot to see what the page shows now, and check the pattern you waited for. If the page is only slow, wait again with a longer \`--timeout\`, such as \`--timeout 30000\`.
      ",
        "Nothing on the page matched "#results" within 10 seconds, so the last step may not have done what you expected. Take a snapshot to see what the page shows now, and check the selector you waited for. If the page is only slow, wait again with a longer \`--timeout\`, such as \`--timeout 30000\`.
      ",
        ""#spinner" did not become hidden within 10 seconds, so the last step may not have done what you expected. Take a snapshot to see what the page shows now, and check the selector you waited for. If the page is only slow, wait again with a longer \`--timeout\`, such as \`--timeout 30000\`.
      ",
      ]
    `);
  });
});

describe("cappedWaitResult", () => {
  const upstreamTimeout = {
    exitCode: 1,
    stderr:
      "✗ Operation timed out. The page may still be loading or the element may not exist.\n",
    stdout: "",
  };

  it("turns the capped network-idle timeout into a loaded page with a busy network", () => {
    expect(
      cappedWaitResult({ kind: "networkidle" }, upstreamTimeout, 5012),
    ).toEqual({ exitCode: 0, stderr: "", stdout: NETWORK_IDLE_GAVE_UP });
  });

  // Upstream prints the same line for a launch or connect failure that
  // mentions a timeout, which comes back before the cap.
  it("passes the timeout line through when it came back before the cap", () => {
    expect(
      cappedWaitResult({ kind: "networkidle" }, upstreamTimeout, 1200),
    ).toBe(upstreamTimeout);
  });

  it.each([
    "✗ CDP connection failed: Timeout connecting to CDP at 127.0.0.1:9222\n",
    "Auto-launch failed: Timeout waiting for DevToolsActivePort\n",
    "✗ CDP error (Page.navigate): CDP command timed out: Page.navigate\n",
  ])("passes a launch or connect timeout through: %s", (stderr) => {
    const result = { exitCode: 1, stderr, stdout: "" };
    expect(cappedWaitResult({ kind: "networkidle" }, result, 5012)).toBe(
      result,
    );
    expect(
      cappedWaitResult(
        { condition: "#a", kind: "selector", state: undefined },
        result,
        10_012,
      ),
    ).toBe(result);
  });

  it("keeps a named wait's timeout a failure and says what to do next", () => {
    const wait = { condition: "Added to Cart", kind: "text" as const };
    expect(
      cappedWaitResult(
        wait,
        {
          exitCode: 1,
          stderr: "✗ Wait timed out after 10000ms\n",
          stdout: "",
        },
        10_012,
      ),
    ).toEqual({ exitCode: 1, stderr: namedWaitGaveUp(wait), stdout: "" });
  });

  it("passes a named wait's timeout through when it names another timeout", () => {
    const result = {
      exitCode: 1,
      stderr: "✗ Wait timed out after 25000ms\n",
      stdout: "",
    };
    expect(
      cappedWaitResult({ condition: "Added", kind: "text" }, result, 25_012),
    ).toBe(result);
  });

  it.each([
    { exitCode: 0, stderr: "", stdout: "✓ Done\n" },
    { exitCode: 1, stderr: "✗ Browser not launched\n", stdout: "" },
  ])("passes $stdout$stderr through", (result) => {
    expect(cappedWaitResult({ kind: "networkidle" }, result, 5012)).toBe(
      result,
    );
    expect(
      cappedWaitResult(
        { condition: "#a", kind: "selector", state: undefined },
        result,
        10_012,
      ),
    ).toBe(result);
  });
});
