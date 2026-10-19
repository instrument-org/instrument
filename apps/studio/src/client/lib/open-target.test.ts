import { expect, it } from "vitest";

import { openTargetOfHref } from "./open-target";

it.each([
  ["", undefined],
  ["#heading", undefined],
  [
    "instrument://chat/2026-09-16-ascii-dog-generation",
    { href: "/chats/2026-09-16-ascii-dog-generation", kind: "screen" },
  ],
  [
    "instrument://file/Users/sam/a.md",
    { kind: "path", path: "/Users/sam/a.md" },
  ],
  ["file:///Users/sam/a%20b.md", { kind: "path", path: "/Users/sam/a b.md" }],
  ["plan.md", { kind: "path", path: "/notes/plan.md" }],
  ["../up.md", { kind: "path", path: "/up.md" }],
  ["https://example.com/x", { kind: "page", url: "https://example.com/x" }],
  ["mailto:a@b.c", { kind: "page", url: "mailto:a@b.c" }],
  ["//example.com/x", { kind: "page", url: "//example.com/x" }],
])("%s", (href, expected) => {
  expect(openTargetOfHref(href, "/notes/")).toEqual(expected);
});

it("leaves a relative link a page when there is no folder to read it against", () => {
  expect(openTargetOfHref("plan.md")).toEqual({ kind: "page", url: "plan.md" });
});
