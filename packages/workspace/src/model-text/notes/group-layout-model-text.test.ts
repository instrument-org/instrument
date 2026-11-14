import { describe, expect, it } from "vitest";

import { type LayoutTab } from "../../schemas/group-layout";
import {
  groupLayoutModelNote,
  layoutChangesModelNote,
} from "./group-layout-model-text";

const CHAT: LayoutTab = {
  address: "instrument://chat/2026-11-13-prices",
  id: "2026-11-13-prices",
  isThisChat: true,
  isUp: true,
  kind: "chat",
  title: "Help desk prices",
};
const ZENDESK: LayoutTab = {
  address: "https://www.zendesk.com/pricing",
  id: "tab_01ZEN",
  isUp: true,
  kind: "website",
  title: "Zendesk pricing",
};
const DOWNLOADS: LayoutTab = {
  address: "/Users/mac-user/Downloads",
  id: "tab_01DL",
  kind: "folder",
  title: "Downloads",
};
const NEW_CHAT: LayoutTab = {
  address: "instrument://new-chat",
  id: "tab_01NEW",
  kind: "newChat",
  title: "New chat",
};

const GROUP = { id: "group_prices" };

describe("groupLayoutModelNote", () => {
  it("names two sides, the keyboard's, and the tab up on each", () => {
    expect(
      groupLayoutModelNote({
        focused: 1,
        group: GROUP,
        sides: [{ tabs: [ZENDESK, DOWNLOADS] }, { tabs: [CHAT, NEW_CHAT] }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The tab group you work in, group_prices, now: two sides, each its tabs in order, "up" marking the one showing there.
      Left: website "Zendesk pricing" at https://www.zendesk.com/pricing (tab_01ZEN, up); folder "Downloads" at /Users/mac-user/Downloads (tab_01DL)
      Right, with the keyboard: this chat (up); new chat (tab_01NEW)
      Tab ids are for commands; in replies, name a tab by its title.
      </instrument-system-note>"
    `);
  });

  it("names one side's tabs on one line", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [{ tabs: [CHAT, { ...DOWNLOADS, isUp: false }] }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The tab group you work in, group_prices, now: one side, its tabs in order, "up" marking the one showing: this chat (up); folder "Downloads" at /Users/mac-user/Downloads (tab_01DL).
      Tab ids are for commands; in replies, name a tab by its title.
      </instrument-system-note>"
    `);
  });

  it("says a group that is the chat alone in a line", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [{ tabs: [CHAT] }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The tab group you work in, group_prices, is just this chat now.
      </instrument-system-note>"
    `);
  });
});

describe("layoutChangesModelNote", () => {
  it("names every kind of change in one line", () => {
    expect(
      layoutChangesModelNote({
        changes: [
          { change: "closed", tab: DOWNLOADS },
          { change: "movedOut", tab: NEW_CHAT, to: "group_launch" },
          { beside: true, change: "opened", side: "left", tab: ZENDESK },
          {
            change: "navigated",
            from: {
              address: "https://www.intercom.com/pricing",
              kind: "website",
              title: "Intercom pricing",
            },
            tab: ZENDESK,
          },
          {
            beside: true,
            change: "movedIn",
            from: "group_launch",
            side: "left",
            tab: DOWNLOADS,
          },
          { change: "moved", from: "left", tab: CHAT, to: "right" },
          {
            after: "Zendesk pricing",
            beside: true,
            change: "moved",
            from: "left",
            tab: DOWNLOADS,
            to: "left",
          },
          { change: "moved", from: "right", tab: ZENDESK, to: undefined },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Changes to the tab group since you were last told, theirs or yours: closed folder "Downloads" (tab_01DL); moved new chat (tab_01NEW) out to the tab group group_launch; opened website "Zendesk pricing" (tab_01ZEN) on the left, beside this chat; tab_01ZEN went from https://www.intercom.com/pricing to website "Zendesk pricing" at https://www.zendesk.com/pricing; moved folder "Downloads" (tab_01DL) in from the tab group group_launch on the left, beside this chat; moved this chat to the right; moved folder "Downloads" (tab_01DL) after "Zendesk pricing"; moved website "Zendesk pricing" (tab_01ZEN) into the group's one side.
      </instrument-system-note>"
    `);
  });

  it("says the chat moved to another group", () => {
    expect(
      layoutChangesModelNote({
        changes: [
          { change: "chatMoved", from: "group_prices", to: "group_launch" },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Changes to the tab group since you were last told, theirs or yours: this chat moved from the tab group group_prices to group_launch.
      </instrument-system-note>"
    `);
  });
});
