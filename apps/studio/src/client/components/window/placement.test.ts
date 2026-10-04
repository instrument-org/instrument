import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { type OpenOptions } from "./context";
import {
  pagePlacementOf,
  type PlacementContext,
  screenPlacementOf,
  tasksPlacementOf,
} from "./placement";

const CHAT = StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA");
const OTHER = StoreId.SessionSchema.parse("ses_01JBBBBBBBBBBBBBBBBBBBBBBB");

const OWN_PAGE = { isFresh: false, isTasks: false, kind: "page" } as const;
const TASK_PAGE = { isFresh: false, isTasks: true, kind: "page" } as const;
const SCREEN = { isFresh: false, isTasks: false, kind: "screen" } as const;
const FRESH = { isFresh: true, isTasks: false, kind: "screen" } as const;

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
      "a tab of the window's own when asked, behind when asked",
      { behind: true, newTab: true },
      inChat(OWN_PAGE),
      { behind: true, kind: "window-tab" },
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
    [
      "beside a task's page, which is the task's",
      {},
      inChat(TASK_PAGE),
      { kind: "new-page", replacesUp: false },
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
      "a tab of the window's own when asked",
      FOLDER,
      { newTab: true },
      inChat(SCREEN),
      { behind: false, kind: "window-tab" },
    ],
    [
      "an app in the window's tab, whatever is up",
      "/apps/linear",
      {},
      inChat(SCREEN),
      { kind: "window-navigate" },
    ],
    [
      "a screen no group's tab stands on in the window's tab",
      "/discover",
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
  ])("opens %s", (_case, href, options, context, expected) => {
    expect(screenPlacementOf(href, options, context)).toEqual(expected);
  });
});

describe("where a chat's tasks open", () => {
  it.each<
    [string, OpenOptions, string | undefined, string | undefined, unknown]
  >([
    [
      "in place, over the tasks the chat on screen has up",
      {},
      CHAT,
      `/tasks?chat=${CHAT}`,
      { kind: "in-place" },
    ],
    [
      "in the chat beside a screen that is not its tasks",
      {},
      CHAT,
      "/files",
      { kind: "in-chat", navigatesWindow: false },
    ],
    [
      "with the chat brought on screen when another is up",
      {},
      OTHER,
      `/tasks?chat=${CHAT}`,
      { kind: "in-chat", navigatesWindow: true },
    ],
    [
      "in a window tab of the chat's own when asked",
      { newTab: true },
      CHAT,
      `/tasks?chat=${CHAT}`,
      { kind: "in-chat", navigatesWindow: true },
    ],
  ])("opens %s", (_case, options, groupOnScreen, upInOwner, expected) => {
    expect(
      tasksPlacementOf(CHAT, options, { groupOnScreen, upInOwner }),
    ).toEqual(expected);
  });
});
