import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { browserTargetOf } from "../types";
import {
  actsIn,
  forgetSessions,
  forgetTab,
  lastActOf,
  noteTabCommand,
  noteTabPages,
  pageOfTab,
  tabOfPage,
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
    noteTabCommand({ tabId: busy, targetId: busy }, actor, 1);
    const others = Array.from({ length: 300 }, newTab);
    for (const [index, tab] of others.entries()) {
      noteTabCommand({ tabId: tab, targetId: tab }, actor, index + 2);
      // The busy tab is used all along.
      noteTabCommand({ tabId: busy, targetId: busy }, actor, index + 2);
    }

    expect(lastActOf(busy, session)).toBe(301);
    expect(lastActOf(others[0]!, session)).toBeUndefined();
  });

  it("drops what a session is owed of a tab once the tab closes", () => {
    const tab = newTab();
    const mine = StoreId.newSessionId();
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: mine },
      1,
    );
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: StoreId.newSessionId() },
      2,
    );
    forgetTab(tab);
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: mine },
      3,
    );

    expect(takeTabNews(mine)).toEqual([]);
  });

  it("drops a session that is gone, with what it was owed", () => {
    const tab = newTab();
    const gone = StoreId.newSessionId();
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: gone },
      1,
    );
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: StoreId.newSessionId() },
      2,
    );
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: gone },
      3,
    );
    forgetSessions([gone]);

    expect(takeTabNews(gone)).toEqual([]);
    expect(lastActOf(tab, gone)).toBeUndefined();
  });

  it("reads a tab as taken over once another session acted in it after this one", () => {
    const tab = newTab();
    const mine = StoreId.newSessionId();
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: mine },
      1,
    );
    expect(takenOverFrom({ tabId: tab, targetId: tab }, mine)).toBe(false);

    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: StoreId.newSessionId() },
      2,
    );
    expect(takenOverFrom({ tabId: tab, targetId: tab }, mine)).toBe(true);
  });
});

describe("a tab whose page changes under it", () => {
  // A tab on an HTML file walked to another file and back, drawn by a new page.
  const walked = () => ({
    first: newTab(),
    next: newTab(),
    tabId: StoreId.newTabId(),
  });

  it("keeps every session's acts and news under the tab's id", () => {
    const { first, next, tabId } = walked();
    const mine = StoreId.newSessionId();
    const other = StoreId.newSessionId();
    noteTabCommand(
      { tabId, targetId: first },
      { chatId: CHAT, sessionId: mine },
      1,
    );
    noteTabCommand(
      { tabId, targetId: next },
      { chatId: CHAT, sessionId: other },
      2,
    );
    noteTabCommand(
      { tabId, targetId: next },
      { chatId: CHAT, sessionId: mine },
      3,
    );

    expect(lastActOf(tabId, mine)).toBe(3);
    expect(actsIn(tabId).map((act) => act.sessionId)).toEqual([mine, other]);
    expect(takeTabNews(mine)).toMatchObject([
      { agents: [{ sessionId: other }], tabId },
    ]);
  });

  it("reads the tab as taken over by a session that acted in its new page", () => {
    const { first, next, tabId } = walked();
    const mine = StoreId.newSessionId();
    noteTabCommand(
      { tabId, targetId: first },
      { chatId: CHAT, sessionId: mine },
      1,
    );
    noteTabCommand(
      { tabId, targetId: next },
      { chatId: CHAT, sessionId: StoreId.newSessionId() },
      2,
    );

    expect(takenOverFrom({ tabId, targetId: next }, mine)).toBe(true);
  });

  it("finds the tab by its page before and after, and the page it has now", () => {
    const { first, next, tabId } = walked();
    noteTabCommand(
      { tabId, targetId: first },
      { chatId: CHAT, sessionId: StoreId.newSessionId() },
    );
    noteTabPages([{ id: tabId, targetId: next }]);
    const unknown = newTab();

    expect(tabOfPage(first)).toBe(tabId);
    expect(tabOfPage(next)).toBe(tabId);
    expect(pageOfTab(tabId)).toBe(next);
    // A page no list or command named goes by its own id, as most page tabs do.
    expect(tabOfPage(unknown)).toBe(unknown);
  });

  it("keeps the page map bounded both ways, letting go of the pages named longest ago", () => {
    const { first, tabId } = walked();
    noteTabPages([{ id: tabId, targetId: first }]);
    noteTabPages(
      Array.from({ length: 1100 }, () => ({
        id: StoreId.newTabId(),
        targetId: newTab(),
      })),
    );

    expect(tabOfPage(first)).toBe(first);
    expect(pageOfTab(tabId)).toBeUndefined();
  });
});
