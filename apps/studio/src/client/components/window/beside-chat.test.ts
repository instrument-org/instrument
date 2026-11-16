import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  agentPlacementOf,
  type BesideAsk,
  type ChatGesture,
  handOverBesideChat,
  OPENS_BESIDE,
  openBesideChat,
  opensBeside,
  pageTypeOf,
  previousOpenedIn,
} from "./beside-chat";
import { groupLayoutOf, type WindowTabs } from "./tab-model";
import { chatHref, newChatHref } from "./window-href";

const CHAT = ChatIdSchema.parse("2026-11-14-renewals");
const G = "group:one";

const chatTab: WindowTab = {
  group: G,
  href: chatHref(CHAT),
  id: "chat",
  kind: "screen",
};
const page = (id: string, side?: 1, openedBy?: typeof CHAT): WindowTab => ({
  group: G,
  id,
  kind: "page",
  openedAt: 0,
  url: `https://${id}.example/`,
  ...(side === undefined ? {} : { side }),
  ...(openedBy === undefined ? {} : { openedBy }),
});
const newTab = (id: string, side?: 1, draft?: string): WindowTab => ({
  group: G,
  href: newChatHref(draft),
  id,
  kind: "screen",
  ...(side === undefined ? {} : { side }),
});
const screenAt = (href: string): WindowTab => ({
  group: G,
  href,
  id: "screen",
  kind: "screen",
});
const onRight = (tab: WindowTab): WindowTab => ({ ...tab, side: 1 });

/** A group of the tabs given, the keyboard on the tab named, the other side's up named too. */
function windowOf(
  tabs: WindowTab[],
  keyboard: string,
  beside?: string,
): WindowTabs {
  return {
    activeByGroup: { [G]: keyboard },
    ...(beside === undefined ? {} : { besideByGroup: { [G]: beside } }),
    tabs,
  };
}

const PERSON: BesideAsk = { chatTab: "chat", gesture: "click" };
const AGENT: BesideAsk = { chatTab: "chat", isShown: false };
const SHOWN: BesideAsk = { chatTab: "chat", isShown: true };
const CMD_CLICK: BesideAsk = { chatTab: "chat", gesture: "background" };

describe("where an agent's open from its chat lands", () => {
  it.each<[string, WindowTabs, BesideAsk, unknown]>([
    [
      "A: alone, a page it shows makes the right side, in front",
      windowOf([chatTab], "chat"),
      SHOWN,
      { after: undefined, front: true, kind: "insert", side: 1 },
    ],
    [
      "A: alone, an agent's page makes the right side, in front",
      windowOf([chatTab], "chat"),
      AGENT,
      { after: undefined, front: true, kind: "insert", side: 1 },
    ],
    [
      "A: alone with other tabs on its side, the right side is still made",
      windowOf([chatTab, page("notes")], "chat"),
      AGENT,
      { after: undefined, front: true, kind: "insert", side: 1 },
    ],
    [
      "A: an unwritten New Tab on the right is replaced",
      windowOf([chatTab, newTab("blank", 1)], "chat", "blank"),
      AGENT,
      { kind: "replace", tab: "blank" },
    ],
    [
      "A: an unwritten New Tab with the keyboard is replaced all the same",
      windowOf([chatTab, newTab("blank", 1)], "blank", "chat"),
      SHOWN,
      { kind: "replace", tab: "blank" },
    ],
    [
      "B: a New Tab with words in it is in use",
      windowOf([chatTab, newTab("draft", 1, "d1")], "chat", "draft"),
      SHOWN,
      { after: "draft", front: true, kind: "insert", side: 1 },
    ],
    [
      "B: a right side in use takes it last, in front",
      windowOf([chatTab, page("a", 1), page("b", 1)], "chat", "a"),
      SHOWN,
      { after: "b", front: true, kind: "insert", side: 1 },
    ],
    [
      "B: an agent's page goes there in front too",
      windowOf([chatTab, page("a", 1)], "chat", "a"),
      AGENT,
      { after: "a", front: true, kind: "insert", side: 1 },
    ],
    [
      "B: with the keyboard in the right side, behind",
      windowOf([chatTab, page("a", 1), page("b", 1)], "b", "chat"),
      SHOWN,
      { after: "b", front: false, kind: "insert", side: 1 },
    ],
    [
      "B: a New Tab beside another tab on the right is in use",
      windowOf([chatTab, page("a", 1), newTab("blank", 1)], "chat", "a"),
      AGENT,
      { after: "blank", front: true, kind: "insert", side: 1 },
    ],
    [
      "C: chat on the right, a page it shows opens right after it, in front",
      windowOf([page("a"), onRight(chatTab), page("b", 1)], "chat", "a"),
      SHOWN,
      { after: "chat", front: true, kind: "insert", side: 1 },
    ],
    [
      "C: in front even with the keyboard on the left",
      windowOf([page("a"), onRight(chatTab)], "a", "chat"),
      SHOWN,
      { after: "chat", front: true, kind: "insert", side: 1 },
    ],
    [
      "C: an agent's page stays behind",
      windowOf([page("a"), onRight(chatTab)], "chat", "a"),
      AGENT,
      { after: "chat", front: false, kind: "insert", side: 1 },
    ],
    [
      "C: nothing opens to the left of it, an unwritten New Tab there included",
      windowOf([newTab("blank"), onRight(chatTab)], "chat", "blank"),
      AGENT,
      { after: "chat", front: false, kind: "insert", side: 1 },
    ],
    [
      "the agent's next page goes after its last, on the right",
      windowOf(
        [chatTab, page("a", 1), page("mine", 1), page("z", 1)],
        "chat",
        "a",
      ),
      { ...AGENT, previous: "mine" },
      { after: "mine", front: true, kind: "insert", side: 1 },
    ],
    [
      "the agent's next page goes after its last, beside a chat on the right, behind",
      windowOf([page("a"), onRight(chatTab), page("mine", 1)], "chat", "a"),
      { ...AGENT, previous: "mine" },
      { after: "mine", front: false, kind: "insert", side: 1 },
    ],
    [
      "the agent's last page left of a chat on the right never takes the next",
      windowOf([page("mine"), onRight(chatTab)], "chat", "mine"),
      { ...AGENT, previous: "mine" },
      { after: "chat", front: false, kind: "insert", side: 1 },
    ],
    [
      "the agent's last page before a chat on the right, in its strip, never takes the next",
      windowOf([page("a"), page("mine", 1), onRight(chatTab)], "chat", "a"),
      { ...AGENT, previous: "mine" },
      { after: "chat", front: false, kind: "insert", side: 1 },
    ],
    [
      "an agent's last page that closed leaves the rule as it is",
      windowOf([chatTab], "chat"),
      { ...AGENT, previous: "gone" },
      { after: undefined, front: true, kind: "insert", side: 1 },
    ],
  ])("%s", (_label, state, ask, expected) => {
    expect(agentPlacementOf(groupLayoutOf(state, G), ask)).toEqual(expected);
  });
});

describe("opening beside a chat", () => {
  const opened = page("opened");
  const agentOpened = page("opened", undefined, CHAT);

  it("makes the right side of a chat alone, the keyboard going with a click", () => {
    const { front, state } = openBesideChat(
      windowOf([chatTab], "chat"),
      opened,
      PERSON,
    );
    const layout = groupLayoutOf(state, G);
    expect(front).toBe(true);
    expect(layout.focused).toBe(1);
    expect(layout.sides.map((side) => side.tabs.map((tab) => tab.id))).toEqual([
      ["chat"],
      ["opened"],
    ]);
  });

  it("takes an unwritten New Tab's place, leaving nothing to go back to", () => {
    const { front, state } = openBesideChat(
      windowOf([chatTab, newTab("blank", 1)], "chat", "blank"),
      opened,
      AGENT,
    );
    const right = groupLayoutOf(state, G).sides[1];
    expect(front).toBe(true);
    expect(right?.up).toBe("opened");
    expect(right?.tabs).toHaveLength(1);
    expect(right?.tabs[0]?.past).toBeUndefined();
  });

  it("leaves what is up on the chat's side up when it waits behind", () => {
    const { front, state } = openBesideChat(
      windowOf([page("a"), onRight(chatTab)], "chat", "a"),
      agentOpened,
      AGENT,
    );
    const layout = groupLayoutOf(state, G);
    expect(front).toBe(false);
    expect(layout.sides[1]?.up).toBe("chat");
    expect(layout.sides[1]?.tabs.map((tab) => tab.id)).toEqual([
      "chat",
      "opened",
    ]);
  });

  it("brings it up on the chat's side for a click, never in the chat's place", () => {
    const { state } = openBesideChat(
      windowOf([page("a"), onRight(chatTab)], "chat", "a"),
      opened,
      PERSON,
    );
    const layout = groupLayoutOf(state, G);
    expect(layout.sides[1]?.up).toBe("opened");
    expect(state.tabs.some((tab) => tab.id === "chat")).toBe(true);
  });

  it("takes the keyboard to the right with what a click brings up there", () => {
    const { state } = openBesideChat(
      windowOf([chatTab, page("a", 1)], "chat", "a"),
      opened,
      PERSON,
    );
    const layout = groupLayoutOf(state, G);
    expect(layout.focused).toBe(1);
    expect(layout.sides[0]?.up).toBe("chat");
    expect(layout.sides[1]?.up).toBe("opened");
  });

  it.each([
    ["an agent's page", agentOpened, AGENT],
    ["an agent's page it shows", agentOpened, SHOWN],
    ["a Cmd-click", opened, CMD_CLICK],
  ])("leaves the keyboard in the chat for %s", (_label, tab, ask) => {
    const { state } = openBesideChat(
      windowOf([chatTab, page("a", 1)], "chat", "a"),
      tab,
      ask,
    );
    expect(groupLayoutOf(state, G).focused).toBe(0);
  });

  it("does nothing for a chat's tab no group has", () => {
    const state = windowOf([chatTab], "chat");
    expect(
      openBesideChat(state, opened, { ...PERSON, chatTab: "gone" }).state,
    ).toBe(state);
  });

  it("finds the agent's last page in the group", () => {
    const state = windowOf(
      [chatTab, page("a", 1, CHAT), page("b", 1), page("c", 1, CHAT)],
      "chat",
    );
    expect(previousOpenedIn(state, G, CHAT)).toBe("c");
  });
});

const OTHER_CHAT = ChatIdSchema.parse("2026-11-15-pricing");
const NOTES = "/Users/mac-user/notes.md";

/** What the person opens, by kind, under the id `opened`. */
const TARGETS = {
  chat: { ...screenAt(chatHref(OTHER_CHAT)), id: "opened" },
  file: { ...screenAt(fileHref(NOTES)), id: "opened" },
  website: page("opened"),
} satisfies Record<string, WindowTab>;

/** Where the chat sits: the only side (with another tab), the left of two, the right of two. */
const POSITIONS = {
  alone: windowOf([chatTab, page("x")], "chat"),
  left: windowOf([chatTab, page("a", 1)], "chat", "a"),
  right: windowOf([page("a"), onRight(chatTab)], "chat", "a"),
} satisfies Record<string, WindowTabs>;

/**
 * Where an open landed, as a line: its side, whether it is up there, the
 * side with the keyboard and the tab it went right after.
 */
function landingOf(state: WindowTabs, id: string): string {
  const layout = groupLayoutOf(state, G);
  const at = layout.sides.findIndex((side) =>
    side.tabs.some((tab) => tab.id === id),
  );
  const side = layout.sides[at];
  const index = side?.tabs.findIndex((tab) => tab.id === id) ?? -1;
  const letter = (n: number) => (n === 0 ? "L" : "R");
  return [
    letter(at),
    side?.up === id ? "up" : "behind",
    `keyboard ${letter(layout.focused)}`,
    `after ${side?.tabs[index - 1]?.id ?? "-"}`,
  ].join(", ");
}

/**
 * The one rule for what the person opens in a chat: only a plain click in a
 * chat on the left (or alone) goes to the other side; everything else is a
 * browser's new tab right after the chat, in front unless asked to wait.
 */
const EXPECTED: Record<ChatGesture, Record<keyof typeof POSITIONS, string>> = {
  background: {
    alone: "L, behind, keyboard L, after chat",
    left: "L, behind, keyboard L, after chat",
    right: "R, behind, keyboard R, after chat",
  },
  click: {
    alone: "R, up, keyboard R, after -",
    left: "R, up, keyboard R, after a",
    right: "R, up, keyboard R, after chat",
  },
  newTab: {
    alone: "L, up, keyboard L, after chat",
    left: "L, up, keyboard L, after chat",
    right: "R, up, keyboard R, after chat",
  },
};

describe("what the person opens in a chat", () => {
  const cases = (["click", "background", "newTab"] as const).flatMap(
    (gesture) =>
      (["alone", "left", "right"] as const).flatMap((position) =>
        (["website", "file", "chat"] as const).map(
          (
            kind,
          ): [ChatGesture, keyof typeof POSITIONS, keyof typeof TARGETS] => [
            gesture,
            position,
            kind,
          ],
        ),
      ),
  );
  it.each(cases)("%s, chat %s, a %s", (gesture, position, kind) => {
    const { front, id, state } = openBesideChat(
      POSITIONS[position],
      TARGETS[kind],
      { chatTab: "chat", gesture },
    );
    expect(id).toBe("opened");
    expect(front).toBe(gesture !== "background");
    expect(landingOf(state, "opened")).toBe(EXPECTED[gesture][position]);
  });

  it("replaces an unwritten New Tab that is all the right side has", () => {
    const { state } = openBesideChat(
      windowOf([chatTab, newTab("blank", 1)], "chat", "chat"),
      page("opened"),
      PERSON,
    );
    expect(groupLayoutOf(state, G).sides[1]?.tabs.map((tab) => tab.id)).toEqual(
      ["opened"],
    );
  });

  // A plain click from a chat on the left brings up the right side's tab
  // already showing the same thing, rather than opening another copy.
  const sameOnRight = (tab: WindowTab) =>
    windowOf(
      [chatTab, page("a", 1), { ...tab, id: "same", side: 1 }],
      "chat",
      "a",
    );
  it.each<[string, WindowTab, WindowTab]>([
    ["the same chat", TARGETS.chat, TARGETS.chat],
    ["the same file", TARGETS.file, TARGETS.file],
    [
      "the same file shown as a page",
      {
        group: G,
        id: "same",
        kind: "page",
        openedAt: 0,
        url: `file://${NOTES}`,
      },
      TARGETS.file,
    ],
    ["a page at the same address", page("opened"), page("opened")],
  ])("brings up %s on a plain click", (_label, there, opening) => {
    const { front, id, state } = openBesideChat(
      sameOnRight(there),
      opening,
      PERSON,
    );
    expect(id).toBe("same");
    expect(front).toBe(true);
    expect(state.tabs.some((tab) => tab.id === "opened")).toBe(false);
    expect(groupLayoutOf(state, G).focused).toBe(1);
  });

  it("opens another tab for a page at another address on the same site", () => {
    const { id } = openBesideChat(
      sameOnRight({
        group: G,
        id: "x",
        kind: "page",
        openedAt: 0,
        url: "https://opened.example/pricing",
      }),
      page("opened"),
      PERSON,
    );
    expect(id).toBe("opened");
  });

  it.each<[string, ChatGesture]>([
    ["a Cmd-click", "background"],
    ["Open in New Tab", "newTab"],
  ])("always opens a new tab for %s", (_label, gesture) => {
    const { id } = openBesideChat(sameOnRight(TARGETS.file), TARGETS.file, {
      chatTab: "chat",
      gesture,
    });
    expect(id).toBe("opened");
  });

  it("never reuses a tab from a chat on the right", () => {
    const { id } = openBesideChat(
      windowOf(
        [page("a"), onRight(chatTab), { ...TARGETS.file, id: "same", side: 1 }],
        "chat",
        "a",
      ),
      TARGETS.file,
      PERSON,
    );
    expect(id).toBe("opened");
  });
});

describe("which pages open beside them", () => {
  it("is only a chat for now", () => {
    expect(
      Object.entries(OPENS_BESIDE)
        .filter(([, on]) => on)
        .map(([type]) => type),
    ).toEqual(["chat"]);
  });

  it.each<[string, WindowTab, string]>([
    ["a chat", chatTab, "chat"],
    ["a website", page("a"), "website"],
    [
      "a file shown as a page",
      {
        group: G,
        id: "f",
        kind: "page",
        openedAt: 0,
        url: "file:///Users/mac-user/notes.pdf",
      },
      "file",
    ],
    ["a file", screenAt(fileHref("/Users/mac-user/notes.md")), "file"],
    ["a folder", screenAt(folderHref("/Users/mac-user/Downloads")), "folder"],
    ["a new tab", newTab("n"), "newTab"],
    ["a built-in page", screenAt("/settings"), "builtIn"],
  ])("reads %s", (_label, tab, type) => {
    expect(pageTypeOf(tab)).toBe(type);
    expect(opensBeside(tab)).toBe(type === "chat");
  });
});

describe("a file a reply handed over, opened as the turn ends", () => {
  const REPORT = fileHref("/Users/mac-user/report.html");
  const hand = (state: WindowTabs) =>
    handOverBesideChat(state, {
      chatTab: "chat",
      href: REPORT,
      id: "handed",
      openedBy: CHAT,
    });

  it("opens a tab of the agent's own beside the chat, in front", () => {
    const opened = hand(windowOf([chatTab], "chat"));
    expect(opened).toMatchObject({ front: true, id: "handed", isNew: true });
    expect(opened.state.tabs.find((tab) => tab.id === "handed")).toMatchObject({
      href: REPORT,
      openedBy: CHAT,
      side: 1,
    });
  });

  it.each<[string, WindowTab]>([
    ["a file tab", onRight({ ...screenAt(REPORT), id: "mine" })],
    [
      "the page the file's tab became",
      {
        group: G,
        id: "mine",
        kind: "page",
        openedAt: 0,
        side: 1,
        url: "file:///Users/mac-user/report.html",
      },
    ],
  ])(
    "brings up %s already showing it, opening none and leaving it the person's",
    (_label, mine) => {
      const state = windowOf(
        [chatTab, mine, onRight(page("other"))],
        "chat",
        "other",
      );
      const opened = hand(state);
      expect(opened).toMatchObject({ id: "mine", isNew: false });
      expect(opened.state.tabs).toHaveLength(3);
      expect(
        opened.state.tabs.find((tab) => tab.id === "mine")?.openedBy,
      ).toBeUndefined();
      expect(groupLayoutOf(opened.state, G).sides[1]?.up).toBe("mine");
    },
  );

  it("opens beside the chat when only another group shows it", () => {
    const elsewhere: WindowTab = {
      ...screenAt(REPORT),
      group: "group:two",
      id: "elsewhere",
    };
    const opened = hand(windowOf([chatTab, elsewhere], "chat"));
    expect(opened).toMatchObject({ id: "handed", isNew: true });
  });
});
