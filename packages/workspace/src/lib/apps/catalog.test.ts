import { afterEach, describe, expect, it } from "vitest";

import {
  appCatalogEntriesHash,
  builtInAppCatalogRevision,
  catalogEntryAt,
  catalogEntryForApp,
  getAppCatalog,
  resetServedAppCatalog,
  applyServedAppCatalog,
} from "./catalog";
import seed from "./catalog-seed.json";

describe("catalogEntryAt", () => {
  it.each([
    ["https://mail.google.com", "gmail"],
    ["https://mail.google.com/mail/u/1/", "gmail"],
    ["https://mail.google.com/mail/?authuser=jeremy%40example.com", "gmail"],
    ["https://calendar.google.com/calendar/r", "google-calendar"],
    ["https://example.invalid/", undefined],
  ])("finds %s as %s", (address, slug) => {
    expect(catalogEntryAt(address)?.slug).toBe(slug);
  });
});

describe("catalogEntryForApp", () => {
  it("finds a second account by the site it is on, whatever its slug", () => {
    expect(
      catalogEntryForApp("gmail-personal", {
        type: "web",
        url: "https://mail.google.com/mail/u/1/",
      })?.slug,
    ).toBe("gmail");
  });

  it("takes the service a manifest names over its slug", () => {
    expect(
      catalogEntryForApp("notion", { service: "gmail", type: "web" })?.slug,
    ).toBe("gmail");
  });
});

describe("the seed's revision", () => {
  it("moves whenever the entries change", () => {
    expect(
      appCatalogEntriesHash(seed.entries),
      "The directory's entries changed: run `pnpm --filter @instrument-org/workspace script:stamp-app-catalog`.",
    ).toBe(seed.entriesHash);
  });
});

describe("applyServedAppCatalog", () => {
  afterEach(resetServedAppCatalog);

  const later = new Date(
    Date.parse(builtInAppCatalogRevision()) + 1000,
  ).toISOString();
  const slack = seed.entries.find((entry) => entry.slug === "slack");

  it("uses a served directory as new as the built-in one", () => {
    expect(
      applyServedAppCatalog({
        entries: [{ ...slack, tagline: "Served." }],
        entriesHash: "",
        revision: later,
      }),
    ).toBe("used");
    expect(getAppCatalog().map((entry) => entry.tagline)).toEqual(["Served."]);
  });

  it("refuses one older than the built-in, which would undo it", () => {
    expect(
      applyServedAppCatalog({
        entries: [slack],
        entriesHash: "",
        revision: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("older");
    expect(getAppCatalog()).toHaveLength(seed.entries.length);
  });

  it("keeps the built-in entry for one this build cannot read, and drops one it has no copy of", () => {
    expect(
      applyServedAppCatalog({
        entries: [
          { ...slack, category: "a-category-from-later" },
          { slug: "unknown-later", tier: "featured" },
        ],
        entriesHash: "",
        revision: later,
      }),
    ).toBe("used");
    expect(getAppCatalog().map((entry) => entry.category)).toEqual([
      slack?.category,
    ]);
  });

  it.each([
    [{}],
    [{ entries: [], entriesHash: "", revision: later }],
    ["<html>"],
  ])("refuses %j", (document) => {
    expect(applyServedAppCatalog(document)).toBe("unreadable");
    expect(getAppCatalog()).toHaveLength(seed.entries.length);
  });
});
