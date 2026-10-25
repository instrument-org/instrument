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
  ])("carries %s as a %s item", (_name, tab, up, kind, owned) => {
    const [item] = itemsFor(tab, { up });
    expect(item?.kind).toBe(kind);
    expect(item?.kind === "tab" ? item.owned : undefined).toBe(owned);
  });

  it("carries nothing for another chat's tab", () => {
    expect(itemsFor(page("theirs", OTHER))).toEqual([]);
    expect(
      itemsFor({ href: `/chats/${OTHER}`, id: "chat", kind: "screen" }),
    ).toEqual([]);
  });

  it("carries nothing it was told to leave out", () => {
    expect(
      chatContextItems({
        chatId: CHAT,
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
      dismissed: [],
      draft,
      finderOf: () => null,
      group: "draft:d",
      inView: undefined,
      ...over,
    });

  it("are what is on screen, then what the person chose", () => {
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
        inView: page("site", "site:1"),
      }).map((item) => item.key),
    ).toEqual([
      "tab:band",
      "tab:site",
      `chat:${OTHER}`,
      "chosen:/Users/sam/a.pdf",
    ]);
  });

  it("follow the screen, less what was dismissed", () => {
    const site = page("site", "site:1");
    expect(forDraft({ inView: site }).map((item) => item.key)).toEqual([
      "tab:site",
    ]);
    expect(forDraft({ dismissed: ["tab:site"], inView: site })).toEqual([]);
    expect(
      forDraft({
        dismissed: ["tab:site"],
        inView: page("other", "site:2"),
      }).map((item) => item.key),
    ).toEqual(["tab:other"]);
  });

  it("never name the chat on screen", () => {
    expect(forDraft({ inView: page("theirs", OTHER) })).toEqual([]);
  });

  it("stand for a page and an app the person chose by their address", () => {
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
