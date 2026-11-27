import { describe, expect, it } from "vitest";

import { isSettingsLink, settingsLinkSchemeOf } from "./settings-links";

describe("settingsLinkSchemeOf", () => {
  it.each([
    ["darwin", "x-apple.systempreferences:"],
    ["win32", "ms-settings:"],
    ["linux", undefined],
  ])("%s: %s", (platform, scheme) => {
    expect(settingsLinkSchemeOf(platform)).toBe(scheme);
  });
});

describe("isSettingsLink", () => {
  it.each([
    ["x-apple.systempreferences:com.apple.Date-Time-Settings.extension", true],
    ["X-Apple.SystemPreferences:com.apple.preference.datetime", true],
    ["ms-settings:dateandtime", true],
    ["ms-settings-other:dateandtime", false],
    ["x-apple.systempreferences.evil:anything", false],
    ["https://support.apple.com/x-apple.systempreferences:", false],
    ["vscode://file/Users/someone", false],
    ["not a link", false],
  ])("%s: %s", (href, settings) => {
    expect(isSettingsLink(href)).toBe(settings);
  });
});
