import { describe, expect, it } from "vitest";

import { isGroupScreenHref } from "./group-screen";

describe("isGroupScreenHref", () => {
  it.each([
    "/browser",
    "/apps",
    "/apps/linear",
    "/tasks/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV?chat=2026-10-01-roofer",
    "/files?path=&root=~",
    "/activity",
    "/release-notes",
    "/extensions",
    "/debug/components/colors",
  ])("lets a group's tab stand at %s", (href) => {
    expect(isGroupScreenHref(href)).toBe(true);
  });

  // A page a later build removed, one a bug built, or an `instrument://`
  // address the app doesn't know: the tab says the page isn't there.
  it.each([
    "/apps/linear/settings",
    "/removed-page?from=older-build",
    "/tasks/not-a-session",
    "/missing?address=instrument%3A%2F%2Fnowhere",
  ])("lets a group's tab stand at %s, an address no screen answers", (href) => {
    expect(isGroupScreenHref(href)).toBe(true);
  });

  it.each([
    "/skills/create-page",
    "/memory/no-stevia",
    "/chats/2026-10-01-roofer",
    "/chats?group=group%3Aa",
  ])("keeps a group's tab from %s", (href) => {
    expect(isGroupScreenHref(href)).toBe(false);
  });
});
