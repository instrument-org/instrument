import { describe, expect, it } from "vitest";

import { unsupportedFeatures } from "./extension-support";

// The parts of real store manifests that decide the answer.
const MANIFESTS = {
  "1Password": {
    commands: { _execute_action: {}, lock: {} },
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
  },
  "Google Keep": {
    oauth2: {},
    permissions: ["activeTab", "identity", "identity.email", "contextMenus"],
  },
  Grammarly: {
    permissions: ["scripting", "sidePanel", "offscreen", "identity"],
    side_panel: {},
  },
  "JSON Formatter": { permissions: ["storage"] },
  Momentum: {
    chrome_url_overrides: { newtab: "index.html" },
    permissions: ["offscreen", "unlimitedStorage", "idle"],
  },
  Rakuten: { permissions: ["storage", "tabs", "webRequest"] },
  "uBlock Origin Lite": {
    commands: { "enter-picker-mode": {}, "enter-zapper-mode": {} },
    permissions: [
      "activeTab",
      "declarativeNetRequest",
      "offscreen",
      "scripting",
      "userScripts",
    ],
  },
};

describe("unsupportedFeatures", () => {
  it("says what of each extension will not work, most noticeable first", () => {
    expect(
      Object.fromEntries(
        Object.entries(MANIFESTS).map(([name, manifest]) => [
          name,
          unsupportedFeatures(manifest),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "1Password": [
          "Blocking content on pages",
        ],
        "Google Keep": [
          "Signing in through the browser",
        ],
        "Grammarly": [],
        "JSON Formatter": [],
        "Momentum": [
          "New tab page",
        ],
        "Rakuten": [
          "Seeing what pages load",
        ],
        "uBlock Origin Lite": [
          "Blocking content on pages",
          "User scripts",
        ],
      }
    `);
  });

  it.each([null, "manifest", { permissions: "tabs", commands: [] }])(
    "answers nothing for a manifest it cannot read (%j)",
    (manifest) => {
      expect(unsupportedFeatures(manifest)).toEqual([]);
    },
  );
});
