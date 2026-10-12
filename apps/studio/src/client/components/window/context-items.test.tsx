import { type WindowTab } from "@/client/atoms/window";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { chatContextItems } from "./context-items";

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
        finderOf: () => null,
        inView: page("site", "site:1"),
        leftOut: ["tab:site"],
        up: undefined,
      }),
    ).toEqual([]);
  });
});
