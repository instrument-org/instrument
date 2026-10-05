import { type WindowTab } from "@/client/atoms/window";
import { describe, expect, it } from "vitest";

import { groupScreenTabsOnly, isGroupScreenHref } from "./group-screen";

describe("isGroupScreenHref", () => {
  it.each([
    "/browser",
    "/new-tab",
    "/apps",
    "/apps/linear",
    "/tasks?chat=ses_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "/files?path=&root=~",
  ])("lets a group's tab stand at %s", (href) => {
    expect(isGroupScreenHref(href)).toBe(true);
  });

  it.each([
    "/release-notes",
    "/debug/errors",
    "/discover",
    "/discover/receipt",
    "/skills/create-page",
    "/memory/no-stevia",
    "/apps/linear/settings",
  ])("keeps a group's tab from %s", (href) => {
    expect(isGroupScreenHref(href)).toBe(false);
  });
});

describe("groupScreenTabsOnly", () => {
  it("drops screen tabs at, or with a step back onto, a screen no group draws", () => {
    const tabs: WindowTab[] = [
      { group: "g", href: "/browser", id: "kept", kind: "screen" },
      {
        group: "g",
        id: "page",
        kind: "page",
        openedAt: 0,
        url: "https://example.com",
      },
      { group: "g", href: "/release-notes", id: "notes", kind: "screen" },
      {
        group: "g",
        href: "/apps",
        id: "walked",
        kind: "screen",
        history: { entries: ["/skills/create-page", "/apps"], index: 1 },
      },
    ];
    expect(groupScreenTabsOnly(tabs).map((tab) => tab.id)).toEqual([
      "kept",
      "page",
    ]);
  });
});
