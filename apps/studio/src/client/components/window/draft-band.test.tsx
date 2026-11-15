import { type WindowTab } from "@/client/atoms/window";
import { type Draft } from "@/shared/drafts";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { siteGroupOf } from "./app-tabs";
import { pagesForChat, pageToChat } from "./draft-band";

const DRAFT: Draft = { createdAt: 0, id: "d1", updatedAt: 0, words: "" };
const CHAT = ChatIdSchema.parse("2026-10-01-lisbon");
const PLAN = { kind: "file" as const, path: "/Users/casey/Notes/plan.md" };

const page = (id: string, url: string): WindowTab => ({
  group: "group:1",
  id,
  kind: "page",
  openedAt: 0,
  url,
});

describe("a page the draft names, at the send", () => {
  const theirs: WindowTab = {
    group: siteGroupOf("s1"),
    id: "tab_theirs",
    kind: "page",
    openedAt: 0,
    url: "https://shop.example/checkout",
  };
  const asked: Draft = {
    ...DRAFT,
    context: [
      { kind: "link", url: theirs.url ?? "" },
      { kind: "link", url: "instrument://app/notion" },
      PLAN,
      { chat: CHAT, kind: "chat" },
    ],
  };

  it("goes to the chat by its address, apart from what the band already shows", () => {
    expect(pagesForChat(asked, [])).toEqual([theirs.url]);
    expect(pagesForChat(asked, [page("t", theirs.url ?? "")])).toEqual([]);
  });

  it("opens right after the chat's tab, behind it, leaving the person's tab where it is", () => {
    const openBehind = vi.fn(() => StoreId.newTabId());
    for (const url of pagesForChat(asked, [])) {
      pageToChat({
        browser: { openBehind },
        chatTab: { group: "group:1", id: "chat" },
        url,
      });
    }
    expect(openBehind.mock.calls).toEqual([
      [theirs.url, { after: "chat", group: "group:1" }],
    ]);
  });
});
