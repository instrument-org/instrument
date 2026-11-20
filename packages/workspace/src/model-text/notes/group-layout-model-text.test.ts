import { describe, expect, it } from "vitest";

import { type LayoutTab } from "../../schemas/group-layout";
import {
  groupLayoutModelNote,
  layoutChangesModelNote,
  tabGroupModelNote,
  tabPlace,
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
  it("names each side's tabs, the one each shows, the keyboard's side and this chat, and what shows beside it", () => {
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
      Your tab group (group_prices):
      left: you (showing) · /Users/mac-user/Documents/notes.md [tab_01NOTES]
      right: zendesk.com/pricing [tab_01ZEN] (showing) · g2.com/compare [tab_01G2]
      </instrument-system-note>"
    `);
  });

  it("says this chat is hidden behind the page covering it", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [
          { tabs: [{ ...DOWNLOADS, isUp: true }, SETTINGS] },
          {
            tabs: [
              { ...CHAT, isUp: false },
              { ...ZENDESK, isUp: true },
              NEW_CHAT,
            ],
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your tab group (group_prices):
      left: [folder] /Users/mac-user/Downloads [tab_01DL] (showing) · [app] Settings [tab_01SET]
      right: you · zendesk.com/pricing [tab_01ZEN] (showing) · New Tab [tab_01NEW]
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
      Your tab group (group_prices):
      you (showing) · [folder] /Users/mac-user/Downloads [tab_01DL]
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
      Your tab group (group_prices):
      you (showing) · google.com/search?q=help+desk+help+desk+help+desk+help+desk+help+desk+help+desk… [tab_01ZEN]
      </instrument-system-note>"
    `);
  });

  it("says when the window shows another group", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        isShown: false,
        sides: [{ tabs: [CHAT] }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your tab group (group_prices):
      you (showing)
      The window shows another tab group, so none of this is on screen.
      </instrument-system-note>"
    `);
  });

  it("says the chat alone in a line", () => {
    expect(
      groupLayoutModelNote({
        focused: 0,
        group: GROUP,
        sides: [{ tabs: [CHAT] }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your tab group (group_prices):
      you (showing)
      </instrument-system-note>"
    `);
  });
});

describe("tabPlace", () => {
  it("says the side, whether it shows, and how it stands against this chat", () => {
    const PAGE: LayoutTab = { ...G2, id: "tab_new", isUp: true };
    const HIDDEN = { ...PAGE, isUp: false };
    const place = (layout: Omit<Parameters<typeof tabPlace>[0], "group">) =>
      tabPlace({ group: GROUP, ...layout }, "tab_new");
    expect({
      beside: place({
        focused: 0,
        sides: [
          { tabs: [CHAT] },
          { tabs: [{ ...ZENDESK, isUp: false }, PAGE] },
        ],
      }),
      covering: place({
        focused: 1,
        sides: [
          { tabs: [ZENDESK] },
          { tabs: [{ ...CHAT, isUp: false }, PAGE] },
        ],
      }),
      hiddenWhereTheyWork: place({
        focused: 1,
        sides: [{ tabs: [CHAT] }, { tabs: [ZENDESK, HIDDEN] }],
      }),
      notOnScreen: place({
        focused: 0,
        isShown: false,
        sides: [{ tabs: [CHAT] }, { tabs: [PAGE] }],
      }),
    }).toMatchInlineSnapshot(`
      {
        "beside": "showing on the right side, beside you",
        "covering": "showing on your side, the right, covering this chat, which is hidden until the user switches back to it",
        "hiddenWhereTheyWork": "hidden on the right side, beside you, behind zendesk.com/pricing, since the user is working on that side",
        "notOnScreen": "showing on the right side, beside you; the window shows another tab group now, so it is not on screen",
      }
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
          { change: "shown", side: "right", tab: { ...G2, isUp: true } },
          { change: "shown", side: undefined, tab: CHAT },
          { change: "groupShown", isShown: false },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Tab group changes: closed [folder] /Users/mac-user/Downloads [tab_01DL]; New Tab [tab_01NEW] moved out to the tab group group_launch; opened zendesk.com/pricing [tab_01ZEN] (showing) on the left; tab_01ZEN went to zendesk.com/pricing; [folder] /Users/mac-user/Downloads [tab_01DL] moved in from the tab group group_launch on the left; moved you (showing) to the right; moved [folder] /Users/mac-user/Downloads [tab_01DL] after Zendesk pricing; moved zendesk.com/pricing [tab_01ZEN] (showing) into the one side; the right shows g2.com/compare [tab_01G2]; now showing you; the window shows another tab group, so none of this one is on screen.
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
      Tab group changes: you moved to the tab group group_launch.
      </instrument-system-note>"
    `);
  });
});

describe("tabGroupModelNote", () => {
  const layout = {
    focused: 0,
    group: GROUP,
    sides: [{ tabs: [CHAT, ZENDESK] }],
  };
  const opened = {
    changes: [{ change: "opened" as const, side: undefined, tab: ZENDESK }],
  };

  it("says the whole group with no changes beside it, and only the changes with them", () => {
    expect({
      first: tabGroupModelNote({ layout }),
      later: tabGroupModelNote({ changes: opened, layout }),
      neither: tabGroupModelNote({}),
    }).toMatchInlineSnapshot(`
      {
        "first": "
      <instrument-system-note>
      Your tab group (group_prices):
      you (showing) · zendesk.com/pricing [tab_01ZEN] (showing)
      </instrument-system-note>",
        "later": "
      <instrument-system-note>
      Tab group changes: opened zendesk.com/pricing [tab_01ZEN] (showing).
      </instrument-system-note>",
        "neither": undefined,
      }
    `);
  });

  it("says the whole group again in another group", () => {
    expect(
      tabGroupModelNote({
        changes: {
          changes: [
            { change: "chatMoved", from: "group_prices", to: "group_launch" },
          ],
        },
        layout: { ...layout, group: { id: "group_launch" } },
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Your tab group (group_launch):
      you (showing) · zendesk.com/pricing [tab_01ZEN] (showing)
      </instrument-system-note>"
    `);
  });
});
