import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  type GroupAwarenessWindow,
  groupLayoutFor,
  layoutReadOf,
} from "./group-awareness";
import { groupLayoutOf, type WindowTabs } from "./tab-model";
import { chatHref, newChatHref } from "./window-href";

const CHAT = ChatIdSchema.parse("2026-11-13-prices");
const GROUP = "group:prices";
const OTHER = "group:launch";

const CHAT_TAB: WindowTab = {
  group: GROUP,
  href: chatHref(CHAT),
  id: "tab_chat",
  kind: "screen",
};
const ZENDESK: WindowTab = {
  group: GROUP,
  id: "tab_zen",
  kind: "page",
  openedAt: 1,
  title: "Zendesk pricing",
  url: "https://www.zendesk.com/pricing",
};
const DOWNLOADS: WindowTab = {
  group: GROUP,
  href: folderHref("/Users/mac-user/Downloads"),
  id: "tab_dl",
  kind: "screen",
};
const QUOTE: WindowTab = {
  group: GROUP,
  href: fileHref("/Users/mac-user/Downloads/quote.pdf"),
  id: "tab_quote",
  kind: "screen",
};
const NEW_CHAT: WindowTab = {
  group: GROUP,
  href: newChatHref(),
  id: "tab_new",
  kind: "screen",
};

/** The right side's tabs, as a group of two sides keeps them. */
const right = (tab: WindowTab): WindowTab => ({ ...tab, side: 1 });

function windowOf(
  tabs: WindowTab[],
  over: Partial<WindowTabs> = {},
): GroupAwarenessWindow {
  const state: WindowTabs = {
    activeByGroup: { [GROUP]: CHAT_TAB.id },
    tabs,
    ...over,
  };
  return {
    appsBySlug: new Map(),
    chatTitles: new Map([[CHAT, "Help desk prices"]]),
    windowTabs: {
      allTabs: tabs,
      groupOnScreen: GROUP,
      layoutOf: (group) => groupLayoutOf(state, group),
    },
  };
}

/** A layout's sides as the tabs' ids, the chat as `@`, the one up starred, the keyboard's side marked `>`. */
function sidesOf(window: GroupAwarenessWindow) {
  const layout = groupLayoutFor(window, GROUP, CHAT_TAB.id);
  return layout.sides.map(
    ({ tabs }, index) =>
      `${index === layout.focused ? ">" : ""}${tabs
        .map((tab) => `${tab.isThisChat ? "@" : tab.id}${tab.isUp ? "*" : ""}`)
        .join(" ")}`,
  );
}

describe("groupLayoutFor", () => {
  it.each<[string, GroupAwarenessWindow, string[]]>([
    ["a chat alone", windowOf([CHAT_TAB]), [">@*"]],
    [
      "pages beside the chat",
      windowOf([ZENDESK, DOWNLOADS, right(CHAT_TAB)], {
        besideByGroup: { [GROUP]: ZENDESK.id },
      }),
      ["tab_zen* tab_dl", ">@*"],
    ],
    [
      "the chat among pages on one side",
      windowOf([ZENDESK, CHAT_TAB]),
      [">tab_zen @*"],
    ],
    [
      "the keyboard on the pages' side",
      windowOf([ZENDESK, right(CHAT_TAB)], {
        activeByGroup: { [GROUP]: ZENDESK.id },
      }),
      [">tab_zen*", "@*"],
    ],
    ["a new chat kept", windowOf([CHAT_TAB, NEW_CHAT]), [">@* tab_new"]],
    [
      "a side of a new chat alone kept",
      windowOf([CHAT_TAB, right(NEW_CHAT)]),
      [">@*", "tab_new*"],
    ],
  ])("%s", (_case, window, sides) => {
    expect(sidesOf(window)).toEqual(sides);
  });

  it("names each tab by kind, title and address", () => {
    expect(
      groupLayoutFor(
        windowOf([ZENDESK, DOWNLOADS, QUOTE, right(CHAT_TAB)], {
          besideByGroup: { [GROUP]: ZENDESK.id },
        }),
        GROUP,
        CHAT_TAB.id,
      ),
    ).toMatchInlineSnapshot(`
      {
        "focused": 1,
        "group": {
          "id": "group:prices",
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
                "id": "tab_chat",
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

  // The id agent-browser drives and `window show` prints, once the tab has
  // a page; before that, the tab's own, which every window action also takes.
  it.each([
    ["by its page's id once it has one", true, "tab_page"],
    ["by its own id before it has a page", false, "tab_site"],
  ])("names a tab on a page's file %s", (_case, hasPage, id) => {
    const site: WindowTab = {
      group: GROUP,
      href: fileHref("/Users/mac-user/site/index.html"),
      id: "tab_site",
      kind: "screen",
    };
    const page: WindowTab = {
      group: "page:tab_site",
      id: "tab_page",
      kind: "page",
      openedAt: 0,
      url: "file:///Users/mac-user/site/index.html",
    };
    expect(
      groupLayoutFor(
        windowOf(hasPage ? [site, page] : [site]),
        GROUP,
        undefined,
      ).sides,
    ).toMatchObject([{ tabs: [{ id, kind: "file" }] }]);
  });

  it("names the new chat a draft is sent from", () => {
    expect(
      groupLayoutFor(windowOf([NEW_CHAT]), GROUP, NEW_CHAT.id).sides,
    ).toMatchObject([
      {
        tabs: [
          { id: "tab_new", isThisChat: true, isUp: true, kind: "newChat" },
        ],
      },
    ]);
  });
});

describe("layoutReadOf", () => {
  it("reads the chat's group, and only the tabs that moved between it and another", () => {
    const read = layoutReadOf(
      windowOf([
        { ...ZENDESK, movedFrom: OTHER },
        { ...DOWNLOADS, group: OTHER, movedFrom: GROUP },
        { ...DOWNLOADS, group: OTHER, id: "tab_stays" },
        CHAT_TAB,
      ]),
      CHAT_TAB.id,
    );
    expect(read?.movedIn).toEqual({ tab_zen: OTHER });
    expect(read?.movedOut).toEqual({ tab_dl: OTHER });
    expect(read?.layout.sides[0]?.tabs.map((tab) => tab.id)).toEqual([
      "tab_zen",
      "tab_chat",
    ]);
  });

  it("marks a tab a chat's agent opened", () => {
    const read = layoutReadOf(
      windowOf([CHAT_TAB, { ...ZENDESK, openedBy: CHAT }]),
      CHAT_TAB.id,
    );
    expect(read?.layout.sides[0]?.tabs[1]).toMatchObject({
      byAgent: true,
      id: "tab_zen",
    });
  });

  it("reads nothing for a tab no group has", () => {
    expect(layoutReadOf(windowOf([]), "tab_gone")).toBeUndefined();
  });
});
