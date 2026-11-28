import { describe, expect, it } from "vitest";

import {
  accessOf,
  newAccessLines,
  permissionLines,
} from "./extension-permissions";

describe("permissionLines", () => {
  it("says what 1Password's manifest asks for, every site first and each line once", () => {
    expect(
      permissionLines({
        origins: ["<all_urls>"],
        permissions: [
          "alarms",
          "contextMenus",
          "downloads",
          "idle",
          "management",
          "nativeMessaging",
          "notifications",
          "privacy",
          "scripting",
          "storage",
          "tabs",
          "webNavigation",
          "webRequest",
          "webRequestAuthProvider",
          "declarativeNetRequestWithHostAccess",
        ],
      }),
    ).toMatchInlineSnapshot(`
      [
        "Read and change what you see on every site",
        "See the addresses and titles of the pages you open",
        "Talk to its own app on this computer",
        "See and manage the browser's other extensions",
        "Manage what you download",
        "Show notifications",
        "Change the browser's privacy settings",
      ]
    `);
  });

  it("names the sites a narrower manifest reaches", () => {
    expect(
      permissionLines({
        origins: ["https://*.github.com/*", "http://localhost/*"],
        permissions: ["storage"],
      }),
    ).toEqual([
      "Read and change what you see on *.github.com",
      "Read and change what you see on localhost",
    ]);
  });

  it("says nothing for a manifest that only runs", () => {
    expect(
      permissionLines({ origins: [], permissions: ["storage", "alarms"] }),
    ).toEqual([]);
    expect(permissionLines({ origins: [], permissions: [] })).toEqual([]);
  });
});

describe("accessOf", () => {
  it("counts the sites content scripts run in", () => {
    expect(
      accessOf({
        content_scripts: [{ matches: ["<all_urls>"] }],
        host_permissions: ["https://a.com/*"],
        permissions: ["storage", { fileSystem: [] }],
      }),
    ).toEqual({
      origins: ["https://a.com/*", "<all_urls>"],
      permissions: ["storage"],
    });
    expect(accessOf("nothing")).toEqual({ origins: [], permissions: [] });
  });
});

describe("newAccessLines", () => {
  const granted = {
    origins: ["https://*.example.com/*"],
    permissions: ["tabs"],
  };
  it.each([
    [["https://mail.example.com/*"], ["webNavigation", "storage"], []],
    [
      ["https://example.org/*"],
      ["tabs"],
      ["Read and change what you see on example.org"],
    ],
    [["*://*/*"], [], ["Read and change what you see on every site"]],
    [[], ["history"], ["Read and change your browsing history"]],
  ])("%j with %j", (origins, permissions, lines) => {
    expect(newAccessLines(granted, { origins, permissions })).toEqual(lines);
  });

  it("asks again of an update that would open what it downloads", () => {
    expect(
      newAccessLines(
        { origins: [], permissions: ["downloads"] },
        { origins: [], permissions: ["downloads", "downloads.open"] },
      ),
    ).toEqual(["Open files you download"]);
  });

  it("finds no site new to one that reaches every site", () => {
    expect(
      newAccessLines(
        { origins: ["<all_urls>"], permissions: [] },
        { origins: ["https://a.com/*"], permissions: [] },
      ),
    ).toEqual([]);
  });
});
