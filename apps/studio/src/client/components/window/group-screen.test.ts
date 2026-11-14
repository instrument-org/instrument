import { describe, expect, it } from "vitest";

import { isGroupScreenHref } from "./group-screen";

describe("isGroupScreenHref", () => {
  it.each([
    "/browser",
    "/new-tab",
    "/apps",
    "/apps/linear",
    "/tasks/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV?chat=2026-10-01-roofer",
    "/files?path=&root=~",
    "/activity",
    "/release-notes",
    "/extensions",
  ])("lets a group's tab stand at %s", (href) => {
    expect(isGroupScreenHref(href)).toBe(true);
  });

  it.each([
    "/debug/errors",
    "/skills/create-page",
    "/memory/no-stevia",
    "/apps/linear/settings",
  ])("keeps a group's tab from %s", (href) => {
    expect(isGroupScreenHref(href)).toBe(false);
  });
});
