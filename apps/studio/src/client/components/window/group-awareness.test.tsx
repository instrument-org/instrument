import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { draftGroupOf } from "@/shared/drafts";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  carryLayoutSent,
  type GroupAwarenessWindow,
  groupLayoutFor,
  layoutReader,
  noteAgentChange,
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
    groups: [
      { group: GROUP, title: "Help desk prices" },
      { group: OTHER, title: "Launch post" },
    ],
    windowTabs: {
      allTabs: tabs,
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
      ["tab_zen*", ">@*"],
    ],
    ["a new chat left out", windowOf([CHAT_TAB, NEW_CHAT]), [">@*"]],
    [
      "a side of new chats alone left out",
      windowOf([CHAT_TAB, right(NEW_CHAT)]),
      [">@*"],
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

describe("layoutReader", () => {
  it("sends no changes first, then what changed since", () => {
    const told = ChatIdSchema.parse("2026-11-13-first");
    const first = layoutReader(windowOf([CHAT_TAB]))(CHAT_TAB.id, told);
    const second = layoutReader(
      windowOf([ZENDESK, right(CHAT_TAB)], {
        besideByGroup: { [GROUP]: ZENDESK.id },
      }),
    )(CHAT_TAB.id, told);
    const third = layoutReader(
      windowOf([ZENDESK, right(CHAT_TAB)], {
        besideByGroup: { [GROUP]: ZENDESK.id },
      }),
    )(CHAT_TAB.id, told);
    expect([first?.changes, second?.changes, third?.changes]).toEqual([
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
    const told = ChatIdSchema.parse("2026-11-13-moves");
    layoutReader(windowOf([ZENDESK, CHAT_TAB]))(CHAT_TAB.id, told);
    expect(
      layoutReader(windowOf([{ ...ZENDESK, group: OTHER }, CHAT_TAB]))(
        CHAT_TAB.id,
        told,
      )?.changes,
    ).toMatchObject([{ change: "movedOut", to: "Launch post" }]);
  });

  it("goes on from a draft's first message to its chat's next", () => {
    const draft = draftGroupOf("drf_1");
    const chat = ChatIdSchema.parse("2026-11-13-started");
    const sending = { ...NEW_CHAT, href: newChatHref("drf_1") };
    layoutReader(windowOf([ZENDESK, sending]))(sending.id, draft);
    carryLayoutSent(draft, chat);
    expect(
      layoutReader(
        windowOf([ZENDESK, { ...sending, href: chatHref(chat) }, DOWNLOADS]),
      )(sending.id, chat)?.changes,
    ).toMatchObject([{ change: "opened", tab: { id: "tab_dl" } }]);
  });

  it("marks what an agent did to the tabs as its own", () => {
    const told = ChatIdSchema.parse("2026-11-13-agent");
    const asked = { ...ZENDESK, id: "tab_asked" };
    const sent: WindowTab = {
      ...ZENDESK,
      id: "tab_sent",
      title: "Example",
      url: "https://example.com/a",
    };
    layoutReader(windowOf([CHAT_TAB, ZENDESK, sent]))(CHAT_TAB.id, told);
    noteAgentChange({ change: "opened", tabId: asked.id });
    noteAgentChange({
      address: "example.com/b",
      change: "navigated",
      tabId: sent.id,
    });
    const after = layoutReader(
      windowOf([
        CHAT_TAB,
        asked,
        { ...sent, url: "https://www.example.com/b/" },
        DOWNLOADS,
      ]),
    )(CHAT_TAB.id, told);
    expect(
      after?.changes.map((one) => [
        one.change,
        "tab" in one ? one.tab.id : "",
        "byAgent" in one ? one.byAgent : undefined,
      ]),
    ).toEqual([
      ["closed", "tab_zen", undefined],
      ["opened", "tab_asked", true],
      ["navigated", "tab_sent", true],
      ["opened", "tab_dl", undefined],
    ]);
  });

  it("reads nothing for a tab no group has", () => {
    expect(layoutReader(windowOf([]))("tab_gone", CHAT)).toBeUndefined();
  });
});
