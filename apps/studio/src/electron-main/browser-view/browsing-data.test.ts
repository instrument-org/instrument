import { describe, expect, it, vi } from "vitest";

import { cookieSitesOf } from "./browsing-data";

vi.mock("@instrument-org/workspace/electron", () => ({
  getBrowserSessionDir: vi.fn(),
}));
vi.mock("./guest-session", () => ({ configureGuestSession: vi.fn() }));

describe("cookieSitesOf", () => {
  it("names each site once by its registrable domain, most cookies first", () => {
    expect(
      cookieSitesOf(
        [
          ".google.com",
          "accounts.google.com",
          "www.google.com",
          "github.com",
          ".github.com",
          "news.bbc.co.uk",
          "someone.github.io",
          "localhost",
          "",
        ].map((domain) => ({ domain })),
      ),
    ).toMatchInlineSnapshot(`
      [
        "google.com",
        "github.com",
        "bbc.co.uk",
        "localhost",
        "someone.github.io",
      ]
    `);
  });
});
