import { describe, expect, it } from "vitest";

import {
  chatFilePageFromHref,
  chatFilePathFromHref,
  isChatFileHref,
} from "./chat-file-href";

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
    ["C:/Users/sam/chart.png", true],
    ["c:/Users/sam/chart.png", true],
    [String.raw`C:\Users\sam\chart.png`, true],
    ["C:%5CUsers%5Csam%5Cchart.png", true],
    [String.raw`\\nas\photos\chart.png`, true],
    ["%5C%5Cnas%5Cphotos%5Cchart.png", true],
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

  it.each([
    "C:/Users/sam/sp%20ace/notes.txt",
    "C:%5CUsers%5Csam%5Csp%20ace%5Cnotes.txt",
  ])("reads a Windows drive link as the shell's spelling: %s", (href) => {
    expect(chatFilePathFromHref(href)).toBe("/c/Users/sam/sp ace/notes.txt");
  });

  it("decodes an escaped separator into a path segment", () => {
    expect(chatFilePathFromHref("output/a%2Fb.png")).toBe("output/a/b.png");
  });
});

describe("a place in the file", () => {
  it.each([
    [
      "/Users/sam/Lease/Alder Street lease.pdf#page=4",
      "/Users/sam/Lease/Alder Street lease.pdf",
    ],
    [
      "/Users/sam/Lease/Alder%20Street%20lease.pdf#page=12",
      "/Users/sam/Lease/Alder Street lease.pdf",
    ],
    ["src/app.ts#L12", "src/app.ts"],
    ["src/app.ts#L12-L20", "src/app.ts"],
    ["notes/#1 ideas.md", "notes/#1 ideas.md"],
    ["notes/take #2.md", "notes/take #2.md"],
    ["report.pdf#pagex=4", "report.pdf#pagex=4"],
  ])("%s names %s", (href, path) => {
    expect(chatFilePathFromHref(href)).toBe(path);
  });

  it.each([
    ["/Users/sam/Lease/Alder Street lease.pdf#page=4", 4],
    ["report.pdf", undefined],
    ["report.pdf#page=0", undefined],
    ["src/app.ts#L12", undefined],
  ])("%s opens at page %s", (href, page) => {
    expect(chatFilePageFromHref(href)).toBe(page);
  });
});
