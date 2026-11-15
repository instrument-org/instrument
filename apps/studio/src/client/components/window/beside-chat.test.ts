import { type WindowTab } from "@/client/atoms/window";
import { fileHref, folderHref } from "@/shared/computer-href";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  type BesideAsk,
  besidePlacementOf,
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

const PERSON: BesideAsk = { behind: false, chatTab: "chat", isShown: true };
const AGENT: BesideAsk = { behind: false, chatTab: "chat", isShown: false };
const CMD_CLICK: BesideAsk = { ...PERSON, behind: true };

describe("where an open from a chat lands", () => {
  it.each<[string, WindowTabs, BesideAsk, unknown]>([
    [
      "A: alone, a click makes the right side, in front",
      windowOf([chatTab], "chat"),
      PERSON,
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
      PERSON,
      { kind: "replace", tab: "blank" },
    ],
    [
      "B: a New Tab with words in it is in use",
      windowOf([chatTab, newTab("draft", 1, "d1")], "chat", "draft"),
      PERSON,
      { after: "draft", front: true, kind: "insert", side: 1 },
    ],
    [
      "B: a right side in use takes it last, in front",
      windowOf([chatTab, page("a", 1), page("b", 1)], "chat", "a"),
      PERSON,
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
      PERSON,
      { after: "b", front: false, kind: "insert", side: 1 },
    ],
    [
      "B: a New Tab beside another tab on the right is in use",
      windowOf([chatTab, page("a", 1), newTab("blank", 1)], "chat", "a"),
      AGENT,
      { after: "blank", front: true, kind: "insert", side: 1 },
    ],
    [
      "C: chat on the right, a click opens right after it, in front",
      windowOf([page("a"), onRight(chatTab), page("b", 1)], "chat", "a"),
      PERSON,
      { after: "chat", front: true, kind: "insert", side: 1 },
    ],
    [
      "C: in front even with the keyboard on the left",
      windowOf([page("a"), onRight(chatTab)], "a", "chat"),
      PERSON,
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
      "D: Cmd-click, alone, makes the right side but never brings it forward",
      windowOf([chatTab], "chat"),
      CMD_CLICK,
      { after: undefined, front: false, kind: "insert", side: 1 },
    ],
    [
      "D: Cmd-click, right side in use, behind",
      windowOf([chatTab, page("a", 1)], "chat", "a"),
      CMD_CLICK,
      { after: "a", front: false, kind: "insert", side: 1 },
    ],
    [
      "D: Cmd-click, chat on the right, behind",
      windowOf([page("a"), onRight(chatTab)], "chat", "a"),
      CMD_CLICK,
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
    expect(besidePlacementOf(groupLayoutOf(state, G), ask)).toEqual(expected);
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
    ["an agent's page it shows", agentOpened, PERSON],
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
