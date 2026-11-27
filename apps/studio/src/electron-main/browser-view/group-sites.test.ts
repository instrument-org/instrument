import { describe, expect, it } from "vitest";

import { groupSites, indexedDbOrigin, localStorageOrigin } from "./group-sites";

const at = (hour: number) => Date.UTC(2026, 10, 27, hour);

describe("groupSites", () => {
  it("groups cookies, visits, site data and apps by registrable domain", () => {
    expect(
      groupSites({
        apps: [
          { slug: "tasky", url: "https://mcp.tasky.example/mcp" },
          { slug: "tasky-api", url: "https://api.tasky.example/v1" },
          // On no site the browser has anything for.
          { slug: "elsewhere", url: "https://api.elsewhere.example" },
        ],
        cookies: [
          { count: 3, host: ".tasky.example", usedAt: at(9) },
          { count: 2, host: "app.tasky.example", usedAt: at(11) },
          { count: 4, host: ".ads.example", usedAt: at(12) },
          { count: 1, host: "localhost" },
          { count: 1, host: "." },
        ],
        siteData: [
          { kind: "Local Storage", origin: "https://app.tasky.example" },
          { kind: "IndexedDB", origin: "https://app.tasky.example" },
          { kind: "Local Storage", origin: "https://notes.someone.github.io" },
        ],
        visits: [
          {
            actor: "user",
            at: at(10),
            count: 10,
            url: "https://app.tasky.example/today",
          },
          {
            actor: "agent",
            at: at(8),
            count: 2,
            url: "https://tasky.example/",
          },
          {
            actor: "user",
            at: at(7),
            count: 1,
            url: "https://news.shop.co.uk/a",
          },
          {
            actor: "user",
            at: at(13),
            count: 1,
            url: "file:///Users/me/a.html",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "cookies": 5,
          "hosts": [
            "app.tasky.example",
            "tasky.example",
          ],
          "setUpAs": [
            "tasky",
            "tasky-api",
          ],
          "site": "tasky.example",
          "siteData": [
            "IndexedDB",
            "Local Storage",
          ],
          "usedAt": 1795777200000,
          "visits": {
            "agent": 2,
            "user": 10,
          },
        },
        {
          "cookies": 4,
          "hosts": [],
          "setUpAs": [],
          "site": "ads.example",
          "siteData": [],
          "usedAt": 1795780800000,
          "visits": {
            "agent": 0,
            "user": 0,
          },
        },
        {
          "cookies": 1,
          "hosts": [],
          "setUpAs": [],
          "site": "localhost",
          "siteData": [],
          "visits": {
            "agent": 0,
            "user": 0,
          },
        },
        {
          "cookies": 0,
          "hosts": [
            "news.shop.co.uk",
          ],
          "setUpAs": [],
          "site": "shop.co.uk",
          "siteData": [],
          "usedAt": 1795762800000,
          "visits": {
            "agent": 0,
            "user": 1,
          },
        },
        {
          "cookies": 0,
          "hosts": [
            "notes.someone.github.io",
          ],
          "setUpAs": [],
          "site": "someone.github.io",
          "siteData": [
            "Local Storage",
          ],
          "visits": {
            "agent": 0,
            "user": 0,
          },
        },
      ]
    `);
  });
});

describe("indexedDbOrigin", () => {
  it.each([
    ["https_www.example.com_0.indexeddb.leveldb", "https://www.example.com"],
    ["https_www.example.com_0.indexeddb.blob", "https://www.example.com"],
    ["http_localhost_8123.indexeddb.leveldb", "http://localhost:8123"],
    ["chrome-extension_abc_0.indexeddb.leveldb", undefined],
    [".DS_Store", undefined],
  ])("reads %s as %s", (folder, origin) => {
    expect(indexedDbOrigin(folder)).toBe(origin);
  });
});

describe("localStorageOrigin", () => {
  it.each([
    ["META:https://www.example.com", "https://www.example.com"],
    ["META:http://localhost:3000", "http://localhost:3000"],
    // A frame's, kept under another site's page.
    ["META:https://embed.example/^0https://news.example", undefined],
    ["META:chrome-extension://abc", undefined],
  ])("reads %s as %s", (key, origin) => {
    expect(localStorageOrigin(key)).toBe(origin);
  });
});
