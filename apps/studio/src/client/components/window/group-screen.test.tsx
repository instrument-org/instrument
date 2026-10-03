import { type WindowTabs } from "@/client/atoms/window";
import { describe, expect, it } from "vitest";

import { groupScreenOf, withGroupScreensOnly } from "./group-screen";

describe("groupScreenOf", () => {
  it.each([
    ["/browser", "browser"],
    ["/new-tab", "newTab"],
    ["/apps", "apps"],
    ["/apps/linear", "app"],
    ["/tasks?chat=ses_01ARZ3NDEKTSV4RRFFQ69G5FAV", "tasks"],
    ["/files?path=&root=~", "computer"],
  ])("draws %s as %s", (href, kind) => {
    expect(groupScreenOf(href)?.kind).toBe(kind);
  });

  it.each([
    "/release-notes",
    "/debug/errors",
    "/discover",
    "/discover/receipt",
    "/skills/create-page",
    "/memory/no-stevia",
    "/apps/linear/settings",
  ])("has no group screen at %s", (href) => {
    expect(groupScreenOf(href)).toBeUndefined();
  });
});

describe("withGroupScreensOnly", () => {
  it("drops screen tabs at, or with a step back onto, a screen no group draws", () => {
    const current: WindowTabs = {
      activeId: "kept",
      tabs: [
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
          at: 1,
          group: "g",
          href: "/apps",
          id: "walked",
          kind: "screen",
          trail: ["/skills/create-page", "/apps"],
        },
      ],
    };
    expect(withGroupScreensOnly(current).tabs.map((tab) => tab.id)).toEqual([
      "kept",
      "page",
    ]);
  });

  it("hands back the same tabs when nothing goes", () => {
    const current: WindowTabs = {
      activeId: null,
      tabs: [{ group: "g", href: "/apps", id: "a", kind: "screen" }],
    };
    expect(withGroupScreensOnly(current)).toBe(current);
  });
});
