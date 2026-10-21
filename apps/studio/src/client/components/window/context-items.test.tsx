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

describe("a draft's chips", () => {
  const draft: Draft = { createdAt: 0, id: "d", updatedAt: 0, words: "" };
  const forDraft = (over: Partial<Parameters<typeof draftContextItems>[0]>) =>
    draftContextItems({
      allTabs: [],
      bandUp: undefined,
      draft,
      finderOf: () => null,
      group: "draft:d",
      ...over,
    });

  it("are its context, then the tab its band has up", () => {
    expect(
      forDraft({
        bandUp: page("band", "draft:d"),
        draft: {
          ...draft,
          context: [
            { chat: OTHER, kind: "chat" },
            { kind: "file", path: "/Users/sam/a.pdf" },
          ],
        },
      }).map((item) => item.key),
    ).toEqual([`chat:${OTHER}`, "chosen:/Users/sam/a.pdf", "tab:band"]);
  });

  it("leave out the band's tab once it is taken off", () => {
    expect(
      forDraft({
        bandUp: page("band", "draft:d"),
        draft: { ...draft, leftOut: ["tab:band"] },
      }),
    ).toEqual([]);
  });

  it("stand for a page and an app by their address", () => {
    const [site, app] = forDraft({
      draft: {
        ...draft,
        context: [
          { kind: "link", url: "https://example.com/" },
          { kind: "link", url: "instrument://app/notion" },
        ],
      },
    });
    expect(site?.kind === "tab" && site.tab).toMatchObject({
      kind: "page",
      url: "https://example.com/",
    });
    expect(app?.kind === "tab" && app.tab).toMatchObject({
      href: "/apps/notion",
      kind: "screen",
    });
  });
});

describe("a chat on screen", () => {
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
