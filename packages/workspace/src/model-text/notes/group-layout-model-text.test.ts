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

const NOTES: LayoutTab = {
  address: "/Users/mac-user/Documents/notes.md",
  id: "tab_01NOTES",
  kind: "file",
  title: "notes.md",
};
const G2: LayoutTab = {
  address: "https://www.g2.com/compare",
  id: "tab_01G2",
  kind: "website",
  title: "Compare help desks",
};
const SETTINGS: LayoutTab = {
  address: "instrument://screen/settings",
  id: "tab_01SET",
  kind: "builtIn",
  title: "Settings",
};

const GROUP = { id: "group_prices" };

describe("groupLayoutModelNote", () => {
  it("names each side's tabs, the one in front on each, the keyboard's side and this chat", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [
          { tabs: [{ ...CHAT, title: "Renewal reminders" }, NOTES] },
          { tabs: [ZENDESK, G2] },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your group (you: left, in front):
      left:  [chat] Renewal reminders (you)* · /Users/mac-user/Documents/notes.md
      right: zendesk.com/pricing* · g2.com/compare
      * in front · keyboard: left
      The tabs in front are most likely what the user is looking at.
      </instrument-system-note>"
    `);
  });

  it("says this chat is behind, on the right, with the keyboard on the left", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [
          { tabs: [{ ...DOWNLOADS, isUp: true }, SETTINGS] },
          { tabs: [{ ...CHAT, isUp: false }, { ...ZENDESK, isUp: true }, NEW_CHAT] },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your group (you: right, behind):
      left:  [folder] /Users/mac-user/Downloads* · [app] Settings
      right: [chat] Help desk prices (you) · zendesk.com/pricing* · New Tab
      * in front · keyboard: left
      The tabs in front are most likely what the user is looking at.
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
      Your group (you: in front):
      [chat] Help desk prices (you)* · [folder] /Users/mac-user/Downloads
      * in front
      The tabs in front are most likely what the user is looking at.
      </instrument-system-note>"
    `);
  });

  it("cuts a long address", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [
          {
            tabs: [
              CHAT,
              {
                ...ZENDESK,
                address: `https://www.google.com/search?q=${"help+desk+".repeat(12)}`,
                isUp: false,
              },
            ],
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your group (you: in front):
      [chat] Help desk prices (you)* · google.com/search?q=help+desk+help+desk+help+desk+help+desk+help+desk+help+desk…
      * in front
      The tabs in front are most likely what the user is looking at.
      </instrument-system-note>"
    `);
  });

  it.each([
    ["the chat alone", [CHAT]],
    ["the chat beside unwritten new chats", [CHAT, NEW_CHAT]],
  ])("says %s in a line", (_label, tabs) => {
    expect(
      groupLayoutModelNote({ focused: 0, group: GROUP, sides: [{ tabs }] }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your tab group is just you now.
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
