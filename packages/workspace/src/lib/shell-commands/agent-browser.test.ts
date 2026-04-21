import { describe, expect, it } from "vitest";

import { shouldCaptureScreenshotFor } from "./agent-browser";

describe("shouldCaptureScreenshotFor", () => {
  it.each([
    { args: ["open", "https://example.com"], expected: true },
    { args: ["navigate", "https://example.com"], expected: true },
    { args: ["goto", "https://example.com"], expected: true },
    { args: ["back"], expected: true },
    { args: ["forward"], expected: true },
    { args: ["reload"], expected: true },
    { args: ["click", "#btn"], expected: true },
    { args: ["dblclick", "#btn"], expected: true },
    { args: ["fill", "#in", "hi"], expected: true },
    { args: ["type", "#in", "hi"], expected: true },
    { args: ["hover", "#x"], expected: true },
    { args: ["focus", "#x"], expected: true },
    { args: ["check", "#x"], expected: true },
    { args: ["uncheck", "#x"], expected: true },
    { args: ["select", "#x", "v"], expected: true },
    { args: ["drag", "#a", "#b"], expected: true },
    { args: ["upload", "#x", "file"], expected: true },
    { args: ["download", "#x", "p"], expected: true },
    { args: ["press", "Enter"], expected: true },
    { args: ["key", "Enter"], expected: true },
    { args: ["keyboard", "type", "hi"], expected: true },
    { args: ["scroll", "100"], expected: true },
    { args: ["wait", "1000"], expected: true },
    { args: ["mouse", "move", "10", "20"], expected: true },
    { args: ["set", "viewport", "1024x768"], expected: true },
    { args: ["tap", "#x"], expected: true },
    { args: ["swipe", "#x", "left"], expected: true },
    { args: ["device", "iPhone 16"], expected: true },
    { args: ["window", "new"], expected: true },
    { args: ["frame", "main"], expected: true },
    { args: ["batch", "click #a", "click #b"], expected: true },
    { args: ["auth"], expected: true },
  ])("captures for $args", ({ args, expected }) => {
    expect(shouldCaptureScreenshotFor(args)).toBe(expected);
  });

  it.each([
    { args: ["get", "title"] },
    { args: ["get", "url"] },
    { args: ["is", "visible", "#x"] },
    { args: ["find", "text", "hi"] },
    { args: ["snapshot"] },
    { args: ["eval", "1+1"] },
    { args: ["inspect", "#x"] },
    { args: ["screenshot"] },
    { args: ["pdf", "out.pdf"] },
    { args: ["console"] },
    { args: ["errors"] },
    { args: ["network", "requests"] },
    { args: ["network", "route", "https://x", "--abort"] },
    { args: ["cookies", "get"] },
    { args: ["cookies", "set", "n", "v"] },
    { args: ["storage", "local", "get"] },
    { args: ["storage", "local", "set", "k", "v"] },
    { args: ["clipboard", "read"] },
    { args: ["diff", "a", "b"] },
    { args: ["record", "start"] },
    { args: ["trace", "start"] },
    { args: ["profiler", "start"] },
    { args: ["highlight", "#x"] },
    { args: ["connect"] },
  ])("skips for $args", ({ args }) => {
    expect(shouldCaptureScreenshotFor(args)).toBe(false);
  });

  it.each([
    { args: ["tab", "list"], expected: false },
    { args: ["tab"], expected: false },
    { args: ["tab", "new"], expected: true },
    { args: ["tab", "close"], expected: true },
    { args: ["tab", "tab_abc"], expected: true },
    { args: ["dialog", "status"], expected: false },
    { args: ["dialog", "accept"], expected: true },
    { args: ["dialog", "dismiss"], expected: true },
  ])("handles mixed-mode pair $args", ({ args, expected }) => {
    expect(shouldCaptureScreenshotFor(args)).toBe(expected);
  });

  it("ignores leading flags when finding the subcommand", () => {
    expect(shouldCaptureScreenshotFor(["--debug", "get", "title"])).toBe(false);
    expect(shouldCaptureScreenshotFor(["--debug", "click", "#x"])).toBe(true);
  });

  it("returns false for empty args", () => {
    expect(shouldCaptureScreenshotFor([])).toBe(false);
  });
});
