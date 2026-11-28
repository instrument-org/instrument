import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { browserTargetOf } from "../../types";
import { noteTabCommand, noteTabPages, takePopups } from "../tab-activity";
import { notePageOpenedTab } from "./popup-tabs";

const opened = vi.hoisted(() => [] as { id: string; session: string }[]);
vi.mock(import("./chat-tabs"), async (importOriginal) => ({
  ...(await importOriginal()),
  noteOpenedTab: (_chatId, id, session) => {
    opened.push({ id, session });
    return Promise.resolve();
  },
}));
vi.mock(import("./tab-cap"), async (importOriginal) => ({
  ...(await importOriginal()),
  closeTabsOverCap: () => Promise.resolve(),
}));

const CHAT = ChatIdSchema.parse("2026-11-27-popups");

describe("a popup a page opened", () => {
  it("is the work of the session that drove its tab, from the page that draws the tab now", () => {
    // A tab on an HTML file, walked to another file and back since the
    // session drove it, drawn by a new page.
    const tabId = StoreId.newTabId();
    const first = browserTargetOf(StoreId.newTabId());
    const next = browserTargetOf(StoreId.newTabId());
    const session = StoreId.newSessionId();
    noteTabCommand(
      { tabId, targetId: first },
      { chatId: CHAT, sessionId: session },
    );
    noteTabPages([{ id: tabId, targetId: next }]);
    const popup = StoreId.newTabId();

    notePageOpenedTab(next, { tabId: popup, url: "https://example.com/" });

    expect(takePopups(session)).toEqual([
      { from: tabId, tabId: popup, url: "https://example.com/" },
    ]);
    expect(opened).toEqual([{ id: popup, session }]);
  });
});
