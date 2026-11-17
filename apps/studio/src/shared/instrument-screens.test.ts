import { instrumentLinkOf } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  builtInPages,
  instrumentAddressOf,
  screenOfHref,
} from "./instrument-screens";

describe("built-in pages", () => {
  it.each([
    ["/settings", { name: "settings" }, "instrument://settings/general"],
    [
      "/settings/providers?setting=x",
      { name: "settings", part: "providers" },
      "instrument://settings/providers",
    ],
    ["/chat-list?q=roof", { name: "chats" }, "instrument://screen/chats"],
    ["/memory", { name: "memory" }, "instrument://screen/memory"],
    ["/skills", { name: "skills" }, "instrument://screen/skills"],
    ["/activity", { name: "activity" }, "instrument://screen/activity"],
    ["/apps", { name: "apps" }, "instrument://screen/apps"],
    ["/files", { name: "files" }, "instrument://screen/files"],
  ])("%s is %j at %s", (href, screen, address) => {
    expect(screenOfHref(href)).toEqual(screen);
    expect(instrumentAddressOf(href)).toBe(address);
  });

  it.each(["/settings/theme", "/memory/roofs", "/files/Users/x", "/chats/c"])(
    "%s is no built-in page",
    (href) => {
      expect(screenOfHref(href)).toBeUndefined();
    },
  );
});

describe("a task's address", () => {
  const href = "/tasks/ses_01J9TASK?chat=2026-11-17-hotels";

  it("names its chat, which opens it from anywhere", () => {
    expect(instrumentAddressOf(href)).toBe(
      "instrument://task/ses_01J9TASK?chat=2026-11-17-hotels",
    );
    expect(instrumentLinkOf(instrumentAddressOf(href) ?? "")?.href).toBe(href);
  });

  it("is the bare task where the tab names no chat", () => {
    expect(instrumentAddressOf("/tasks/ses_01J9TASK")).toBe(
      "instrument://task/ses_01J9TASK",
    );
  });
});

it("offers every built-in page by name, each part of Settings with it", () => {
  expect(builtInPages().map(({ address, title }) => `${title}: ${address}`))
    .toMatchInlineSnapshot(`
      [
        "History: instrument://screen/activity",
        "Apps: instrument://screen/apps",
        "Bookmarks: instrument://screen/bookmarks",
        "Browser: instrument://screen/browser",
        "Chats: instrument://screen/chats",
        "Extensions: instrument://screen/extensions",
        "Files: instrument://screen/files",
        "Memory: instrument://screen/memory",
        "Release notes: instrument://screen/release-notes",
        "Settings: instrument://settings/general",
        "Settings › Account: instrument://settings/account",
        "Settings › Providers: instrument://settings/providers",
        "Settings › Apps: instrument://settings/apps",
        "Settings › Permissions: instrument://settings/permissions",
        "Settings › Storage: instrument://settings/storage",
        "Settings › History: instrument://settings/activity",
        "Keyboard shortcuts: instrument://screen/shortcuts",
        "Skills: instrument://screen/skills",
      ]
    `);
});
