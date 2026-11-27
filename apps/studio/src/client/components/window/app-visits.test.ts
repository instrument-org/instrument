import { describe, expect, it } from "vitest";

import { isOnSite, visitsWithin } from "./app-visits";

describe("isOnSite", () => {
  it.each([
    [
      "the site's own host",
      "https://linear.app/instrument/issue/INS-409",
      true,
    ],
    ["a host under the site", "https://app.asana.com/0/inbox", true],
    ["www in front of either", "https://www.notion.so/acme/Use-Cases", true],
    ["a host that only ends the same", "https://notlinear.app/x", false],
    ["another site", "https://mail.google.com/mail/u/0/", false],
    ["words that are not an address", "linear issues", false],
  ])("reads %s", (_case, url, expected) => {
    const site = url.includes("asana")
      ? "https://asana.com"
      : url.includes("notion")
        ? "https://www.notion.so"
        : "https://linear.app";
    expect(isOnSite(url, site)).toBe(expected);
  });
});

describe("visitsWithin", () => {
  const apps = [
    { name: "Linear", site: "https://linear.app" },
    { name: "Gmail", site: "https://mail.google.com" },
    { name: "Local", site: undefined },
  ];
  const visited = [
    { at: 3, title: "Inbox", url: "https://mail.google.com/mail/u/0/#inbox" },
    { at: 2, title: "Weather", url: "https://weather.com/today" },
    {
      at: 1,
      title: "INS-409",
      url: "https://linear.app/instrument/issue/INS-409",
    },
  ];

  it("keeps the pages on the apps' sites in the order they were visited, each with its app", () => {
    expect(
      visitsWithin(visited, apps).map(({ app, page }) => [
        app.name,
        page.title,
      ]),
    ).toEqual([
      ["Gmail", "Inbox"],
      ["Linear", "INS-409"],
    ]);
  });

  it("takes the pages at an app's home on another site, held to the home's path", () => {
    const google = [
      {
        home: "https://mail.google.com",
        name: "Gmail",
        site: "https://gmail.com",
      },
      {
        home: "https://docs.google.com/spreadsheets/",
        name: "Google Sheets",
        site: "https://sheets.google.com",
      },
    ];
    const pages = [
      { title: "Inbox", url: "https://mail.google.com/mail/u/0/#inbox" },
      {
        title: "Budget",
        url: "https://docs.google.com/spreadsheets/d/1a2b/edit",
      },
      { title: "Notes", url: "https://docs.google.com/document/d/3c4d/edit" },
      { title: "Lookalike", url: "https://docs.google.com/spreadsheetsx" },
    ];

    expect(
      visitsWithin(pages, google).map(({ app, page }) => [
        app.name,
        page.title,
      ]),
    ).toEqual([
      ["Gmail", "Inbox"],
      ["Google Sheets", "Budget"],
    ]);
  });

  it("holds to one app's site when asked about that app alone", () => {
    expect(
      visitsWithin(visited, apps.slice(0, 1)).map(({ page }) => page.title),
    ).toEqual(["INS-409"]);
  });
});
