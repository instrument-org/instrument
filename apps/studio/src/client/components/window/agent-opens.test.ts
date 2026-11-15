import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  agentChatTabOf,
  NO_CHAT,
  NO_CHAT_TAB,
  pageOpenPlaceOf,
  tabHrefOfAppAddress,
} from "./agent-opens";
import { type BesideAsk, openBesideChat } from "./beside-chat";
import { type WindowTabs } from "./tab-model";
import { chatHref, newChatHref } from "./window-href";
import { workingTabOf } from "@/shared/working-tab";

const CHAT = ChatIdSchema.parse("2026-11-14-example-com");
const G = "group:chat";
const OTHER = "group:other";

const chatTab = (group = G, side?: 1): WindowTab => ({
  group,
  href: chatHref(CHAT),
  id: `chat-${group}`,
  kind: "screen",
  ...(side === undefined ? {} : { side }),
});
const page = (id: string, group = G, side?: 1): WindowTab => ({
  group,
  id,
  kind: "page",
  openedAt: 0,
  url: `https://${id}.example/`,
  ...(side === undefined ? {} : { side }),
});
const blank = (id: string, group = G, side?: 1): WindowTab => ({
  group,
  href: newChatHref(),
  id,
  kind: "screen",
  ...(side === undefined ? {} : { side }),
});

const groupsOf = (state: WindowTabs) =>
  new Set(state.tabs.flatMap((tab) => (tab.group ? [tab.group] : [])));

/** The window the agent's asks are answered against, with the groups an open window lists. */
const working =
  (state: WindowTabs, listed: readonly string[] = [G, OTHER]) =>
  (chat: string) =>
    workingTabOf(state.tabs, chat, (group) => listed.includes(group));

describe("an agent never makes a tab group", () => {
  it("opens beside the chat's tab, in its group", () => {
    const state: WindowTabs = {
      activeByGroup: {},
      tabs: [chatTab(), page("mine", OTHER)],
    };
    expect(agentChatTabOf(CHAT, working(state))).toEqual({
      after: `chat-${G}`,
      group: G,
    });
  });

  it("refuses for a chat whose tab the person closed, rather than making a group", () => {
    const state: WindowTabs = {
      activeByGroup: {},
      tabs: [page("mine", OTHER)],
    };
    expect(agentChatTabOf(CHAT, working(state))).toEqual({
      error: NO_CHAT_TAB,
    });
  });

  it("refuses for a chat whose only tab is in a group no open window lists", () => {
    const state: WindowTabs = { activeByGroup: {}, tabs: [chatTab(OTHER)] };
    expect(agentChatTabOf(CHAT, working(state, [G]))).toEqual({
      error: NO_CHAT_TAB,
    });
  });

  it("refuses an ask from no chat at all", () => {
    expect(agentChatTabOf(undefined, () => undefined)).toEqual({
      error: NO_CHAT,
    });
  });

  // `window show`, `agent-browser tab new`, a page it starts in that goes
  // somewhere (`adopt`), and a file or folder: each lands where
  // `openBesideChat` puts it, which only ever adds to the chat's group.
  const AGENT: BesideAsk = {
    chatTab: `chat-${G}`,
    isShown: false,
  };
  const SHOWN: BesideAsk = { ...AGENT, isShown: true };
  it.each<[string, WindowTab[], BesideAsk]>([
    ["chat alone, shown", [chatTab()], SHOWN],
    ["chat alone, working page", [chatTab()], AGENT],
    ["chat on the left, a right side", [chatTab(), page("a", G, 1)], SHOWN],
    ["chat on the left, a New Tab right", [chatTab(), blank("b", G, 1)], SHOWN],
    ["chat on the right, shown", [page("a"), chatTab(G, 1)], SHOWN],
    ["chat on the right, working page", [page("a"), chatTab(G, 1)], AGENT],
    [
      "another group beside, up or not",
      [chatTab(), page("x", OTHER), page("y", OTHER, 1)],
      SHOWN,
    ],
    [
      "after the agent's last page",
      [chatTab(), { ...page("prev", G, 1), openedBy: CHAT }],
      { ...AGENT, previous: "prev" },
    ],
  ])("%s: the page goes in the chat's group", (_label, tabs, ask) => {
    const before: WindowTabs = { activeByGroup: {}, tabs };
    const { state } = openBesideChat(before, page("opened", G), ask);
    expect(groupsOf(state)).toEqual(groupsOf(before));
    expect(state.tabs.find((tab) => tab.id === "opened")?.group).toBe(G);
  });

  it("opens nothing beside a chat's tab no group has", () => {
    const before: WindowTabs = { activeByGroup: {}, tabs: [page("x", OTHER)] };
    const { state } = openBesideChat(before, page("opened"), AGENT);
    expect(state).toBe(before);
  });
});

describe("a tab a page asks for", () => {
  it.each<
    [
      string,
      { group?: string; id: string } | undefined,
      boolean,
      ReturnType<typeof pageOpenPlaceOf>,
    ]
  >([
    [
      "an agent's popup goes right after its page, in its group",
      { group: G, id: "p" },
      true,
      { after: "p", group: G, kind: "after" },
    ],
    [
      "an agent's popup from a page with no tab opens nothing",
      { id: "p" },
      true,
      { kind: "none" },
    ],
    [
      "an agent's popup from a page the window has no tab for opens nothing",
      undefined,
      true,
      { kind: "none" },
    ],
    [
      "the person's link goes right after its page",
      { group: G, id: "p" },
      false,
      { after: "p", group: G, kind: "after" },
    ],
    [
      "the person's link from a page with no group opens as theirs would",
      undefined,
      false,
      { kind: "free" },
    ],
  ])("%s", (_label, asking, isAgent, expected) => {
    expect(pageOpenPlaceOf(asking, { isAgent })).toEqual(expected);
  });
});

describe("an app address an agent opens", () => {
  it.each([
    [
      "instrument://chat/2026-11-14-make-this-red-6zks",
      "/chats/2026-11-14-make-this-red-6zks",
    ],
    ["instrument://app/notion", "/apps/notion"],
    ["instrument://settings/providers", "/settings/providers"],
    ["instrument://screen/chats", "/chat-list"],
    ["instrument://screen/activity", "/activity"],
    ["instrument://memory/no-stevia", undefined],
    ["instrument://settings/no-such-row", undefined],
    ["instrument://new-chat", undefined],
  ])("%s opens at %s", (address, href) => {
    expect(tabHrefOfAppAddress(address)).toBe(href);
  });
});
