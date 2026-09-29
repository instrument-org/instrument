import { describe, expect, it } from "vitest";

import { hostedPageStep } from "./hosted-page";
import { linkTargetOf } from "./link-address";

describe("linkTargetOf", () => {
  it.each([
    [
      "https://example.com/a",
      undefined,
      { kind: "page", url: "https://example.com/a" },
    ],
    [
      "mailto:me@example.com",
      undefined,
      { kind: "page", url: "mailto:me@example.com" },
    ],
    ["#section", "/Users/me/notes", { kind: "stay" }],
    ["", "/Users/me/notes", { kind: "stay" }],
    ["javascript:alert(1)", "/Users/me/notes", { kind: "none" }],
    ["other.md", undefined, { kind: "none" }],
    [
      "other.md",
      "/Users/me/notes",
      { kind: "file", path: "/Users/me/notes/other.md" },
    ],
    [
      "../site/b.html#top",
      "/Users/me/notes",
      { kind: "file", path: "/Users/me/site/b.html" },
    ],
    [
      "file:///Users/me/a%20b.html",
      undefined,
      { kind: "file", path: "/Users/me/a b.html" },
    ],
    [
      "instrument://skill/pdf",
      undefined,
      { href: "/orchestrator/skills/pdf", kind: "screen" },
    ],
  ])("reads %s against %s", (href, base, target) => {
    expect(linkTargetOf(href, base === undefined ? {} : { base })).toEqual(
      target,
    );
  });
});

describe("hostedPageStep", () => {
  const fileUrl = "file:///Users/me/site/a.html";

  it.each([
    ["file:///Users/me/site/a.html", undefined],
    ["file:///Users/me/site/a.html#bottom", undefined],
    ["file:///Users/me/site/a.html?instrument-edit=1", undefined],
    ["about:blank", undefined],
    [
      "file:///Users/me/site/b.html",
      { kind: "file", path: "/Users/me/site/b.html" },
    ],
    ["https://example.com/", { kind: "site", url: "https://example.com/" }],
  ])("reads %s", (url, step) => {
    expect(hostedPageStep(url, { fileUrl })).toEqual(step);
  });
});
