import { describe, expect, it } from "vitest";

import { catalogEntryAt, catalogEntryForApp } from "./catalog";

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
