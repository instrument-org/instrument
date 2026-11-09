import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { browserTargetOf } from "../types";
import {
  forgetSessions,
  forgetTab,
  lastActOf,
  noteTabCommand,
  takenOverFrom,
  takeTabNews,
} from "./tab-activity";

const CHAT = ChatIdSchema.parse("2026-11-08-shop");
const newTab = () => browserTargetOf(StoreId.newTabId());

describe("what is kept of each tab's work", () => {
  it("lets go of the tabs acted in longest ago, keeping one still in use", () => {
    const session = StoreId.newSessionId();
    const actor = { chatId: CHAT, sessionId: session };
    const busy = newTab();
    noteTabCommand(busy, actor, 1);
    const others = Array.from({ length: 300 }, newTab);
    for (const [index, tab] of others.entries()) {
      noteTabCommand(tab, actor, index + 2);
      // The busy tab is used all along.
      noteTabCommand(busy, actor, index + 2);
    }

    expect(lastActOf(busy, session)).toBe(301);
    expect(lastActOf(others[0]!, session)).toBeUndefined();
  });

  it("drops what a session is owed of a tab once the tab closes", () => {
    const tab = newTab();
    const mine = StoreId.newSessionId();
    noteTabCommand(tab, { chatId: CHAT, sessionId: mine }, 1);
    noteTabCommand(tab, { chatId: CHAT, sessionId: StoreId.newSessionId() }, 2);
    forgetTab(tab);
    noteTabCommand(tab, { chatId: CHAT, sessionId: mine }, 3);

    expect(takeTabNews(mine)).toEqual([]);
  });

  it("drops a session that is gone, with what it was owed", () => {
    const tab = newTab();
    const gone = StoreId.newSessionId();
    noteTabCommand(tab, { chatId: CHAT, sessionId: gone }, 1);
    noteTabCommand(tab, { chatId: CHAT, sessionId: StoreId.newSessionId() }, 2);
    noteTabCommand(tab, { chatId: CHAT, sessionId: gone }, 3);
    forgetSessions([gone]);

    expect(takeTabNews(gone)).toEqual([]);
    expect(lastActOf(tab, gone)).toBeUndefined();
  });

  it("reads a tab as taken over once another session acted in it after this one", () => {
    const tab = newTab();
    const mine = StoreId.newSessionId();
    noteTabCommand(tab, { chatId: CHAT, sessionId: mine }, 1);
    expect(takenOverFrom(tab, mine)).toBe(false);

    noteTabCommand(tab, { chatId: CHAT, sessionId: StoreId.newSessionId() }, 2);
    expect(takenOverFrom(tab, mine)).toBe(true);
  });
});
