import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { draftGroupOf } from "@/shared/drafts";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  carryLayoutSent,
  type GroupAwarenessWindow,
  layoutReader,
  todaysGroupLayout,
} from "./group-awareness";

const CHAT = ChatIdSchema.parse("2026-11-13-prices");
const OTHER = ChatIdSchema.parse("2026-11-13-launch");

const ZENDESK: WindowTab = {
  group: CHAT,
  id: "tab_zen",
  kind: "page",
  openedAt: 1,
  title: "Zendesk pricing",
  url: "https://www.zendesk.com/pricing",
};
const DOWNLOADS: WindowTab = {
  group: CHAT,
  href: folderHref("/Users/mac-user/Downloads"),
  id: "tab_dl",
  kind: "screen",
};
const QUOTE: WindowTab = {
  group: CHAT,
  href: fileHref("/Users/mac-user/Downloads/quote.pdf"),
  id: "tab_quote",
  kind: "screen",
};
const NEW_TAB: WindowTab = {
  group: CHAT,
  href: NEW_TAB_HREF,
  id: "tab_new",
  kind: "screen",
};

function windowOf(
  allTabs: WindowTab[],
  over: Partial<GroupAwarenessWindow> = {},
): GroupAwarenessWindow {
  return {
    appsBySlug: new Map(),
    chatClosedByGroup: {},
    chatTitles: new Map([[CHAT, "Help desk prices"]]),
    groups: [
      { group: CHAT, title: "Help desk prices" },
      { group: OTHER, title: "Launch post" },
    ],
    windowTabs: {
      allTabs,
      selectedTabIn: (group) =>
        allTabs.find((tab) => tab.group === group && tab.id !== "tab_new"),
    },
    ...over,
  };
}

/** A layout's sides as the tabs' ids, the chat as `@`, the one up starred. */
function sidesOf(window: GroupAwarenessWindow, group: string = CHAT) {
  return todaysGroupLayout(window, group).sides.map(({ tabs }) =>
    tabs
      .map((tab) => `${tab.isThisChat ? "@" : tab.id}${tab.isUp ? "*" : ""}`)
      .join(" "),
  );
}

describe("todaysGroupLayout", () => {
  it.each<[string, GroupAwarenessWindow, string[]]>([
    ["a chat alone", windowOf([]), ["@*"]],
    [
      "the work beside the chat",
      windowOf([ZENDESK, DOWNLOADS]),
      ["tab_zen* tab_dl", "@*"],
    ],
    [
      "the chat's card closed",
      windowOf([ZENDESK], { chatClosedByGroup: { [CHAT]: true } }),
      ["tab_zen* @"],
    ],
    ["a new tab left out", windowOf([NEW_TAB]), ["@*"]],
  ])("%s", (_case, window, sides) => {
    expect(sidesOf(window)).toEqual(sides);
  });

  it("names each tab by kind, title and address", () => {
    expect(todaysGroupLayout(windowOf([ZENDESK, DOWNLOADS, QUOTE]), CHAT))
      .toMatchInlineSnapshot(`
        {
          "focused": 1,
          "group": {
            "id": "2026-11-13-prices",
            "title": "Help desk prices",
          },
          "sides": [
            {
              "tabs": [
                {
                  "address": "https://www.zendesk.com/pricing",
                  "id": "tab_zen",
                  "isUp": true,
                  "kind": "website",
                  "title": "Zendesk pricing",
                },
                {
                  "address": "/Users/mac-user/Downloads",
                  "id": "tab_dl",
                  "kind": "folder",
                  "title": "Downloads",
                },
                {
                  "address": "/Users/mac-user/Downloads/quote.pdf",
                  "id": "tab_quote",
                  "kind": "file",
                  "title": "quote.pdf",
                },
              ],
            },
            {
              "tabs": [
                {
                  "address": "instrument://chat/2026-11-13-prices",
                  "id": "2026-11-13-prices",
                  "isThisChat": true,
                  "isUp": true,
                  "kind": "chat",
                  "title": "Help desk prices",
                },
              ],
            },
          ],
        }
      `);
  });
});

describe("layoutReader", () => {
  it("sends no changes first, then what changed since", () => {
    const first = layoutReader(windowOf([]))(CHAT);
    const second = layoutReader(windowOf([ZENDESK]))(CHAT);
    const third = layoutReader(windowOf([ZENDESK]))(CHAT);
    expect([first.changes, second.changes, third.changes]).toEqual([
      [],
      [
        {
          beside: true,
          change: "opened",
          side: "left",
          tab: {
            address: "https://www.zendesk.com/pricing",
            id: "tab_zen",
            kind: "website",
            title: "Zendesk pricing",
          },
        },
      ],
      [],
    ]);
  });

  it("says a tab went to another group of the window", () => {
    const group = ChatIdSchema.parse("2026-11-13-moves");
    const window = (tabs: WindowTab[]) =>
      windowOf(tabs, {
        groups: [
          { group, title: "Moves" },
          { group: OTHER, title: "Launch post" },
        ],
      });
    const tab = { ...ZENDESK, group };
    layoutReader(window([tab]))(group);
    expect(
      layoutReader(window([{ ...tab, group: OTHER }]))(group).changes,
    ).toMatchObject([{ change: "movedOut", to: "Launch post" }]);
  });

  it("goes on from a draft's first message to its chat's next", () => {
    const draft = draftGroupOf("drf_1");
    const chat = ChatIdSchema.parse("2026-11-13-started");
    const tab = { ...ZENDESK, group: draft };
    layoutReader(windowOf([tab]))(draft);
    carryLayoutSent(draft, chat);
    expect(
      layoutReader(
        windowOf([
          { ...tab, group: chat },
          { ...DOWNLOADS, group: chat },
        ]),
      )(chat).changes,
    ).toMatchObject([{ change: "opened", tab: { id: "tab_dl" } }]);
  });
});
