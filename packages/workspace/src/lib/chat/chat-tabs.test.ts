import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { browserTargetOf } from "../../types";
import { noteTabCommand } from "../tab-activity";
import { tabHolders } from "./chat-tabs";
import { chatWorkingIn, isDrivenByWorkingAgent } from "./driven-tabs";

const CHAT = ChatIdSchema.parse("2026-11-27-report");
const TASK = StoreId.newSessionId();

/** The chat's page tabs as the window lists them. */
let pages: { id: string; targetId: string; title: string; url: string }[] = [];

vi.mock(import("./window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: () => Promise.resolve({ pages, requestId: "list" }),
}));
vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveChat: (id: string) => ChatIdSchema.parse(id),
}));
vi.mock(import("./children"), async (importOriginal) => ({
  ...(await importOriginal()),
  listChildTasks: () =>
    Promise.resolve([
      { handle: "t1", id: TASK, title: "Check the report" },
    ] as Awaited<ReturnType<(typeof import("./children"))["listChildTasks"]>>),
}));
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: () => true,
}));

beforeEach(() => {
  pages = [];
});

describe("a task at work in a tab on an HTML file whose page changed", () => {
  /** The task drove the file's page, then the file tab walked to another file and back, drawn by a new page. */
  function walked() {
    const tabId = StoreId.newTabId();
    const first = browserTargetOf(StoreId.newTabId());
    const next = browserTargetOf(StoreId.newTabId());
    noteTabCommand(
      { tabId, targetId: first },
      { chatId: CHAT, sessionId: TASK },
    );
    pages = [
      { id: tabId, targetId: next, title: "Report", url: "file:///r.html" },
    ];
    return { next, tabId };
  }

  it("still holds the tab", async () => {
    const { tabId } = walked();

    expect((await tabHolders(CHAT)).get(tabId)).toEqual({
      id: "t1",
      session: TASK,
      title: "Check the report",
    });
  });

  it("marks the new page as worked in by the chat", async () => {
    const { next } = walked();
    // The window's list is what names the new page.
    await tabHolders(CHAT);

    expect(chatWorkingIn(next)).toBe(CHAT);
    expect(await isDrivenByWorkingAgent(next)).toBe(true);
  });
});
