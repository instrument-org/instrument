import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { type OpenOptions } from "./context";
import {
  reuseBlankOf,
  chatPlacementOf,
  gestureOf,
  inGroup,
  pagePlacementOf,
  type PlacementContext,
  screenPlacementOf,
} from "./placement";

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const OTHER = ChatIdSchema.parse("2026-10-02-trip");

const OWN_PAGE = { isFresh: false, kind: "page" } as const;
const SCREEN = { isFresh: false, kind: "screen" } as const;
const FRESH = { isFresh: true, kind: "screen" } as const;

const inChat = (
  up: PlacementContext["up"],
  groupOnScreen: string = CHAT,
): PlacementContext => ({ groupOnScreen, isChatOnScreen: true, up });
const NO_GROUP: PlacementContext = {
  groupOnScreen: undefined,
  isChatOnScreen: false,
  up: undefined,
};
const SITE: PlacementContext = {
  groupOnScreen: "site:abc",
  isChatOnScreen: false,
  up: OWN_PAGE,
};

describe("where a page opens", () => {
  it.each<[string, OpenOptions, PlacementContext, unknown]>([
    [
      "a tab beside the one up when asked, behind when asked",
      { behind: true, newTab: true },
      inChat(OWN_PAGE),
      { behind: true, kind: "group-new-tab" },
    ],
    [
      "a tab in another chat when asked there, waiting",
      { behind: true, group: OTHER, newTab: true },
      inChat(OWN_PAGE),
      { activate: false, group: OTHER, kind: "group-behind", show: false },
    ],
    [
      "into another chat, waiting there",
      { group: OTHER },
      inChat(SCREEN),
      { activate: false, group: OTHER, kind: "group-behind", show: false },
    ],
    [
      "into another chat, shown",
      { group: OTHER, show: true },
      inChat(SCREEN),
      { activate: false, group: OTHER, kind: "group-behind", show: true },
    ],
    [
      "as a site in the window's tab when no group is on screen",
      { replace: true },
      NO_GROUP,
      { kind: "window-site", replace: true },
    ],
    ["in the page up", {}, inChat(OWN_PAGE), { kind: "navigate-up" }],
    ["in a site's page up", {}, SITE, { kind: "navigate-up" }],
    [
      "in place of a screen up",
      {},
      inChat(SCREEN),
      { kind: "new-page", replacesUp: true },
    ],
    // A website linked from a built-in page (Settings) asks for a new tab,
    // as a browser's `target="_blank"` does, and keeps the page beside it.
    [
      "in a new tab in front beside a built-in page, never a group",
      { newTab: true },
      inChat(SCREEN),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "in a tab of its own when asked",
      { ownTab: true },
      inChat(OWN_PAGE),
      { kind: "own-tab" },
    ],
    [
      "in the new tab up even when a tab of its own is asked for",
      { ownTab: true },
      inChat(FRESH),
      { kind: "new-page", replacesUp: true },
    ],
    [
      "as the first tab of a chat with nothing up",
      {},
      inChat(undefined),
      { kind: "new-page", replacesUp: false },
    ],
  ])("opens %s", (_case, options, context, expected) => {
    expect(pagePlacementOf(options, context)).toEqual(expected);
  });
});

describe("where a screen opens", () => {
  const FOLDER = "/files?path=&root=~";
  it.each<[string, string, OpenOptions, PlacementContext, unknown]>([
    [
      "a tab beside the one up when asked",
      FOLDER,
      { newTab: true },
      inChat(SCREEN),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "a tab beside the one up and behind it when asked",
      FOLDER,
      { behind: true, newTab: true },
      inChat(SCREEN),
      { behind: true, kind: "group-new-tab" },
    ],
    [
      "an app in the window's tab, whatever is up",
      "/apps/linear",
      {},
      inChat(SCREEN),
      { kind: "window-navigate" },
    ],
    [
      "an app in a tab beside the one up, behind it, when asked",
      "/apps/linear",
      { behind: true, newTab: true },
      inChat(SCREEN),
      { behind: true, kind: "group-new-tab" },
    ],
    [
      "an app in a tab beside the one up when asked",
      "/apps/linear",
      { newTab: true },
      inChat(SCREEN),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "a screen no group's tab stands on in the window's tab, even when asked for a tab",
      "/debug/errors",
      { behind: true, newTab: true },
      inChat(SCREEN),
      { kind: "window-navigate" },
    ],
    [
      "a screen no group's tab stands on in the window's tab",
      "/debug/errors",
      { group: OTHER },
      inChat(SCREEN),
      { kind: "window-navigate" },
    ],
    [
      "into another chat, brought up there when activated",
      FOLDER,
      { activate: true, group: OTHER },
      inChat(SCREEN),
      { group: OTHER, kind: "group-behind", select: true, show: false },
    ],
    [
      "in the window's tab outside a chat",
      FOLDER,
      {},
      SITE,
      { kind: "window-navigate" },
    ],
    [
      "as the first tab of a chat with nothing up",
      FOLDER,
      {},
      inChat(undefined),
      { kind: "group-open" },
    ],
    [
      "in a tab of its own when asked",
      FOLDER,
      { ownTab: true },
      inChat(SCREEN),
      { kind: "group-own-tab" },
    ],
    [
      "in the new tab up even when a tab of its own is asked for",
      FOLDER,
      { ownTab: true },
      inChat(FRESH),
      { kind: "group-navigate" },
    ],
    [
      "in place of what is up",
      FOLDER,
      {},
      inChat(OWN_PAGE),
      { kind: "group-navigate" },
    ],
    // A built-in page linked from another (Settings' release notes or
    // history) walks the tab there, and back returns.
    ...(["/release-notes", "/activity"] as const).map(
      (href) =>
        [
          `${href} in place of the built-in page up`,
          href,
          {},
          inChat(SCREEN),
          { kind: "group-navigate" },
        ] satisfies [string, string, OpenOptions, PlacementContext, unknown],
    ),
    [
      "a built-in page behind, beside the one up, from a Cmd-click",
      "/release-notes",
      { behind: true, newTab: true },
      inChat(SCREEN),
      { behind: true, kind: "group-new-tab" },
    ],
  ])("opens %s", (_case, href, options, context, expected) => {
    expect(screenPlacementOf(href, options, context)).toEqual(expected);
  });
});

// Only a menu's Open in New Tab Group (or New Window) makes a group from
// inside a window, whatever the gesture.
const GESTURES: [string, OpenOptions][] = [
  ["a plain click", {}],
  ["a Cmd-click or a middle click", { behind: true, newTab: true }],
  ["Open in New Tab", { newTab: true }],
  ["a Shift-click", { newWindow: true }],
];

describe("a gesture inside the window", () => {
  it.each(GESTURES)("%s keeps to the group", (_label, gesture) => {
    expect(inGroup(gesture).newWindow).toBeUndefined();
    expect(inGroup({ ...gesture, chat: CHAT }).newWindow).toBeUndefined();
  });

  it("keeps Open in New Tab from a chat in front", () => {
    expect(inGroup({ chat: CHAT, newTab: true })).toEqual({
      chat: CHAT,
      newTab: true,
    });
  });

  it.each<[string, OpenOptions, ReturnType<typeof gestureOf>]>([
    ["a plain click", { show: true }, "click"],
    [
      "a Cmd-click or a middle click",
      { behind: true, newTab: true },
      "background",
    ],
    ["Open in New Tab", { newTab: true }, "newTab"],
    ["a Shift-click", { newWindow: true }, "newTab"],
  ])("reads %s as its gesture", (_label, options, gesture) => {
    expect(gestureOf(options)).toBe(gesture);
  });

  it("brings a Shift-click's tab up", () => {
    expect(inGroup({ newWindow: true })).toEqual({
      behind: false,
      newTab: true,
    });
  });

  it.each(GESTURES)(
    "%s opens a page as a tab of the group up",
    (_label, gesture) => {
      expect(
        pagePlacementOf(inGroup(gesture), inChat(OWN_PAGE)).kind,
      ).not.toMatch(/^window-/);
    },
  );

  it.each(GESTURES)(
    "%s opens a screen as a tab of the group up",
    (_label, gesture) => {
      expect(
        screenPlacementOf("/activity", inGroup(gesture), inChat(SCREEN)).kind,
      ).not.toBe("window-tab");
    },
  );
});

describe("where a chat opened inside the window goes", () => {
  const beside = { after: "chat-tab", group: CHAT, isBeside: true };
  const after = { after: "page-tab", group: CHAT, isBeside: false };
  it.each<
    [
      string,
      OpenOptions,
      Parameters<typeof chatPlacementOf>[1],
      PlacementContext,
      ReturnType<typeof chatPlacementOf>,
    ]
  >([
    [
      "clicked in a chat: from it, a click",
      { chat: OTHER },
      beside,
      inChat(SCREEN),
      { chatTab: "chat-tab", gesture: "click", kind: "beside" },
    ],
    [
      "Cmd-clicked in a chat: from it, in the background",
      { behind: true, chat: OTHER, newTab: true },
      beside,
      inChat(SCREEN),
      { chatTab: "chat-tab", gesture: "background", kind: "beside" },
    ],
    [
      "Open in New Tab in a chat: from it, a new tab",
      { chat: OTHER, newTab: true },
      beside,
      inChat(SCREEN),
      { chatTab: "chat-tab", gesture: "newTab", kind: "beside" },
    ],
    [
      "Shift-clicked in a chat: from it, a new tab",
      { chat: OTHER, newWindow: true },
      beside,
      inChat(SCREEN),
      { chatTab: "chat-tab", gesture: "newTab", kind: "beside" },
    ],
    [
      "from a tab that opens nothing beside it: right after it",
      { chat: OTHER },
      after,
      inChat(SCREEN),
      { after: "page-tab", behind: false, group: CHAT, kind: "after" },
    ],
    [
      "from a chip, ⌘K or the omnibar: after the tab up",
      {},
      undefined,
      inChat(SCREEN),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "the Chats list's Cmd-click: after the tab up, behind",
      { behind: true, newTab: true },
      undefined,
      inChat(SCREEN),
      { behind: true, kind: "group-new-tab" },
    ],
    [
      "Open in New Tab Group: a group, as the menu says",
      { into: "group" },
      beside,
      inChat(SCREEN),
      { into: "group", kind: "menu" },
    ],
    [
      "with no group up: a group of its own, having nowhere else",
      {},
      undefined,
      NO_GROUP,
      { kind: "own-group" },
    ],
  ])("%s", (_label, asked, place, context, expected) => {
    expect(chatPlacementOf(asked, place, context)).toEqual(expected);
  });
});

describe("what the app opens beside the tab up", () => {
  it.each<[string, OpenOptions, PlacementContext, unknown]>([
    [
      "from a blank New Tab: takes the tab over",
      { newTab: "reuseBlank" },
      inChat(FRESH),
      { kind: "group-navigate" },
    ],
    [
      "from a tab with something in it: a new tab after it",
      { newTab: "reuseBlank" },
      inChat(SCREEN),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "from a page: a new tab after it",
      { newTab: "reuseBlank" },
      inChat(OWN_PAGE),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "with no group up: a window tab",
      { newTab: "reuseBlank" },
      NO_GROUP,
      { behind: false, kind: "window-tab" },
    ],
    [
      "Open in New Tab from a blank New Tab: still a new tab",
      { newTab: true },
      inChat(FRESH),
      { behind: false, kind: "group-new-tab" },
    ],
    [
      "a Cmd-click from a blank New Tab: still a tab behind",
      { behind: true, newTab: true },
      inChat(FRESH),
      { behind: true, kind: "group-new-tab" },
    ],
  ])("%s", (_label, asked, context, expected) => {
    expect(
      screenPlacementOf(
        "/settings/general",
        reuseBlankOf(asked, context),
        context,
      ),
    ).toEqual(expected);
  });

  it("leaves a menu's place as picked", () => {
    expect(
      reuseBlankOf({ newTab: "reuseBlank", into: "split" }, inChat(FRESH)),
    ).toEqual({ into: "split" });
  });
});
