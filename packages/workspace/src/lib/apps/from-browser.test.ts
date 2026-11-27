import { describe, expect, it } from "vitest";

import { type AppCatalogEntry } from "./catalog";
import { catalogEntriesFromBrowser } from "./from-browser";

/** A directory entry with only what matching reads set. */
function entry(
  slug: string,
  domain: string,
  {
    formats = ["mcp"],
    home,
    tier = "listed",
  }: {
    formats?: string[];
    home?: string;
    tier?: AppCatalogEntry["tier"];
  } = {},
): AppCatalogEntry {
  return {
    authMethods: [],
    category: "tasks",
    description: "",
    domain,
    ...(home === undefined ? {} : { home }),
    interfaces: formats.map((format) => ({ format, name: slug })),
    name: slug,
    slug,
    tagline: "",
    tier,
  };
}

/**
 * A made-up directory: one vendor whose services share a site (four on
 * `search.example`, three of them at one host), a service alone on its
 * domain with its web app on a subdomain, a store with a cloud service
 * below it, and the maker's Mac-only apps.
 */
const DIRECTORY = [
  entry("search-mail", "searchmail.example", {
    home: "https://mail.search.example",
  }),
  entry("search-docs", "docs.search.example", {
    home: "https://docs.search.example/document/",
  }),
  entry("search-sheets", "sheets.search.example", {
    home: "https://docs.search.example/spreadsheets/",
  }),
  entry("search-calendar", "calendar.search.example"),
  entry("tasky", "tasky.example", { home: "https://app.tasky.example" }),
  entry("shop", "shop.example"),
  entry("shop-cloud", "cloud.shop.example", {
    home: "https://docs.cloud.shop.example",
    tier: "hidden",
  }),
  entry("shop-cloud-console", "console.shop.example"),
  entry("fruit-notes", "fruit.example", { formats: ["mac-app"] }),
  entry("fruit-mail", "fruit.example", { formats: ["mac-app"] }),
];

const match = (...addresses: string[]) =>
  catalogEntriesFromBrowser(
    addresses.map((address) => ({ address })),
    DIRECTORY,
  ).map(({ slug }) => slug);

describe("catalogEntriesFromBrowser", () => {
  it.each([
    ["the vendor's own front page", "https://www.search.example/", []],
    ["the vendor's sign-in page", "https://accounts.search.example/", []],
    [
      "a service's web app",
      "https://mail.search.example/u/1/",
      ["search-mail"],
    ],
    [
      "a page of one of three services at one host, by its path",
      "https://docs.search.example/spreadsheets/d/1/edit",
      ["search-sheets"],
    ],
    [
      "an origin three services share a host on",
      "https://docs.search.example",
      [],
    ],
    [
      "a service by its own domain",
      "https://calendar.search.example/",
      ["search-calendar"],
    ],
    ["a single service's domain", "https://tasky.example/pricing", ["tasky"]],
    ["a subdomain of its domain", "https://www.tasky.example/", ["tasky"]],
    [
      "a subdomain of its web app",
      "https://eu.app.tasky.example/projects",
      ["tasky"],
    ],
    [
      "the store, not the services below it",
      "https://www.shop.example/",
      ["shop"],
    ],
    [
      "the nearest of two services above a host",
      "https://eu.console.shop.example/",
      ["shop-cloud-console"],
    ],
    [
      "a hidden entry's host as the site above it",
      "https://docs.cloud.shop.example/",
      ["shop"],
    ],
    ["no Mac app by its maker's site", "https://www.fruit.example/", []],
    ["nothing on another site", "https://tasky.example.org/", []],
    ["nothing for words that are not an address", "tasky.example", []],
  ])("finds %s", (_, address, slugs) => {
    expect(match(address)).toEqual(slugs);
  });

  it("names each service once, most recently used first, by the host used last", () => {
    expect(
      catalogEntriesFromBrowser(
        [
          { address: "https://www.tasky.example/", at: 1 },
          { address: "https://mail.search.example/", at: 2 },
          { address: "https://app.tasky.example/today", at: 3 },
          // Site data says no when.
          { address: "https://calendar.search.example" },
        ],
        DIRECTORY,
      ),
    ).toEqual([
      { host: "app.tasky.example", slug: "tasky" },
      { host: "mail.search.example", slug: "search-mail" },
      { host: "calendar.search.example", slug: "search-calendar" },
    ]);
  });
});
