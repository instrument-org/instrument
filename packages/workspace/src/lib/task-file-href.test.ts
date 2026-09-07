import { describe, expect, it } from "vitest";

import { isTaskFileHref, taskFilePathFromHref } from "./task-file-href";

describe("isTaskFileHref", () => {
  it.each([
    ["output/chart.png", true],
    ["./output/chart.png", true],
    ["a folder/chart.png", true],
    ["#section", false],
    ["//example.com/chart.png", false],
    ["https://example.com/chart.png", false],
    ["HTTPS://example.com/chart.png", false],
    ["mailto:someone@example.com", false],
    ["data:text/plain,hi", false],
  ])("%s -> %s", (href, expected) => {
    expect(isTaskFileHref(href)).toBe(expected);
  });
});

describe("taskFilePathFromHref", () => {
  it("drops the agent-facing ./ prefix", () => {
    expect(taskFilePathFromHref("./output/chart.png")).toBe("output/chart.png");
  });

  it("decodes an escaped space", () => {
    expect(taskFilePathFromHref("output/my%20chart.png")).toBe(
      "output/my chart.png",
    );
  });

  // A percent sign is a legal filename character, so a link to one is not
  // malformed markdown -- it is just not percent-encoding.
  it("keeps a raw percent sign", () => {
    expect(taskFilePathFromHref("output/100%.png")).toBe("output/100%.png");
  });

  it("keeps a truncated escape sequence", () => {
    expect(taskFilePathFromHref("output/100%2.png")).toBe("output/100%2.png");
  });

  it("decodes an escaped separator into a path segment", () => {
    expect(taskFilePathFromHref("output/a%2Fb.png")).toBe("output/a/b.png");
  });
});
