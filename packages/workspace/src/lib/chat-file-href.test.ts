import { describe, expect, it } from "vitest";

import { isChatFileHref, chatFilePathFromHref } from "./chat-file-href";

describe("isChatFileHref", () => {
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
    expect(isChatFileHref(href)).toBe(expected);
  });
});

describe("chatFilePathFromHref", () => {
  it("drops the agent-facing ./ prefix", () => {
    expect(chatFilePathFromHref("./output/chart.png")).toBe("output/chart.png");
  });

  it("decodes an escaped space", () => {
    expect(chatFilePathFromHref("output/my%20chart.png")).toBe(
      "output/my chart.png",
    );
  });

  // A percent sign is a legal filename character, so a link to one is not
  // malformed markdown -- it is just not percent-encoding.
  it("keeps a raw percent sign", () => {
    expect(chatFilePathFromHref("output/100%.png")).toBe("output/100%.png");
  });

  it("keeps a truncated escape sequence", () => {
    expect(chatFilePathFromHref("output/100%2.png")).toBe("output/100%2.png");
  });

  it("decodes an escaped separator into a path segment", () => {
    expect(chatFilePathFromHref("output/a%2Fb.png")).toBe("output/a/b.png");
  });
});
