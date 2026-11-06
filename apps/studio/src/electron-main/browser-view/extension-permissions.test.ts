import { describe, expect, it } from "vitest";

import { permissionLines } from "./extension-permissions";

describe("permissionLines", () => {
  it("says what 1Password's manifest asks for, every site first and each line once", () => {
    expect(
      permissionLines({
        host_permissions: ["<all_urls>"],
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
        host_permissions: ["https://*.github.com/*", "http://localhost/*"],
        permissions: ["storage"],
      }),
    ).toEqual([
      "Read and change what you see on *.github.com",
      "Read and change what you see on localhost",
    ]);
  });

  it("says nothing for a manifest that only runs", () => {
    expect(permissionLines({ permissions: ["storage", "alarms"] })).toEqual([]);
    expect(permissionLines({})).toEqual([]);
  });
});
