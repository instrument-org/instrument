import { type Draft } from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { chatContextItems, draftContextItems } from "./context-items";

const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const OTHER = ChatIdSchema.parse("2026-10-02-porto");

const page = (id: string, group: string): WindowTab => ({
  group,
  id,
  kind: "page",
  openedAt: 1,
  title: "Example",
  url: "https://example.com/",
});

/** What a chat composer carries for one tab, in view behind it or up in its own view. */
function itemsFor(tab: WindowTab, { up = false } = {}) {
  return chatContextItems({
    chatId: CHAT,
    chatOnScreen: undefined,
    finderOf: () => null,
    inView: up ? undefined : tab,
    leftOut: [],
    up: up ? tab : undefined,
  });
}

describe("chatContextItems", () => {
  it.each([
    [
      "the chat's own tab, up in its view",
      page("own", CHAT),
      true,
      "tab",
      true,
    ],
    ["a page of the window's own", page("site", "site:1"), false, "tab", false],
    ["another chat's tab", page("theirs", OTHER), false, "chat", undefined],
  ])("carries %s as a %s item", (_name, tab, up, kind, owned) => {
    const [item] = itemsFor(tab, { up });
    expect(item?.kind).toBe(kind);
    expect(item?.kind === "tab" ? item.owned : undefined).toBe(owned);
  });

  it("names another chat by its id alone, never its tab", () => {
    expect(itemsFor(page("theirs", OTHER))).toEqual([
      { chat: OTHER, key: "tab:theirs", kind: "chat" },
    ]);
  });

  it("carries nothing it was told to leave out", () => {
    expect(
      chatContextItems({
        chatId: CHAT,
        chatOnScreen: undefined,
        finderOf: () => null,
        inView: page("site", "site:1"),
        leftOut: ["tab:site"],
        up: undefined,
      }),
    ).toEqual([]);
  });
});

describe("a chat on screen", () => {
  const draft: Draft = { createdAt: 0, id: "d", updatedAt: 0, words: "" };
  const forDraft = (over: Partial<Parameters<typeof draftContextItems>[0]>) =>
    draftContextItems({
      allTabs: [],
      bandUp: undefined,
      chatOnScreen: undefined,
      draft,
      finderOf: () => null,
      group: "draft:d",
      hrefOfAppTab: () => undefined,
      inView: undefined,
      ...over,
    });

  it("is a chat chip behind a draft, its pane open or not", () => {
    expect(forDraft({ chatOnScreen: OTHER })).toEqual([
      { chat: OTHER, key: `chat:${OTHER}`, kind: "chat" },
    ]);
    expect(
      forDraft({ chatOnScreen: OTHER, inView: page("theirs", OTHER) }),
    ).toEqual([{ chat: OTHER, key: `chat:${OTHER}`, kind: "chat" }]);
  });

  it("is the chat a draft opened over it names, and one chip with what is behind", () => {
    expect(
      forDraft({
        chatOnScreen: OTHER,
        draft: { ...draft, included: { chat: OTHER } },
      }),
    ).toEqual([{ chat: OTHER, key: `chat:${OTHER}`, kind: "chat" }]);
  });

  it("is a chat chip behind a popped-out chat, and nothing behind itself", () => {
    const behind = (chatOnScreen: typeof CHAT) =>
      chatContextItems({
        chatId: CHAT,
        chatOnScreen,
        finderOf: () => null,
        inView: undefined,
        leftOut: [],
        up: undefined,
      });
    expect(behind(OTHER)).toEqual([
      { chat: OTHER, key: `chat:${OTHER}`, kind: "chat" },
    ]);
    expect(behind(CHAT)).toEqual([]);
  });
});
