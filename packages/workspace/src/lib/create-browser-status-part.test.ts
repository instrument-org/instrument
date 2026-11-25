import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { type BrowserTargetId, type WorkspaceConfig } from "../types";
import { createBrowserStatusPart } from "./create-browser-status-part";

const CHAT_ID = ChatIdSchema.parse("2026-11-23-find-the-order");
const SESSION_ID = StoreId.newSessionId();

/** The chat's tabs as the window lists them, a page's guest up or not. */
let windowList: { id: string; kind: "page"; title: string; url: string }[] = [];
/** The tabs whose pages are loaded, by the title and address their guests report. */
let loaded = new Map<string, { title: string; url: string }>();
let openedTabs: { id: string }[] = [];

vi.mock("./chat/chat-tabs", () => ({
  chatPageTabs: () =>
    Promise.resolve(
      windowList.map((entry) => ({
        ...entry,
        targetId: entry.id as BrowserTargetId,
      })),
    ),
  takeClosedTabs: () => Promise.resolve([]),
}));
vi.mock("./chat-record", () => ({
  getChatState: () => Promise.resolve({ closedTabs: [], openedTabs }),
}));
vi.mock("./record-folders", () => ({
  chatDir: (id: string) => `/tmp/chats/${id}`,
}));
vi.mock("./session-layout", () => ({
  sessionLayout: () => Promise.resolve({}),
}));
vi.mock("./local-page-address", () => ({
  agentSpellingOfFileUrls: (url: string) => url,
}));
vi.mock("./workspace-config", () => ({
  getWorkspaceConfig: () =>
    // Only the browser's reads of its tabs are asked for here.
    ({
      browser: {
        getTargetMeta: (id: string) =>
          loaded.has(id) ? { partitionDir: "/tmp/profile" } : null,
        getTargetAddress: (id: string) => loaded.get(id)?.url,
        getTargetUrl: (id: string) => loaded.get(id)?.url,
        guestCost: () => null,
        hasNoWindow: false,
        isGuestAsleep: () => false,
        listTargets: () =>
          Promise.resolve(
            [...loaded].map(([id, page]) => ({ id, type: "page", ...page })),
          ),
      },
      captureException: (error: unknown) => {
        throw error;
      },
    }) as unknown as WorkspaceConfig,
}));

async function tabsTold() {
  const part = await createBrowserStatusPart({
    chatId: CHAT_ID,
    createdAt: new Date(0),
    messageId: StoreId.newMessageId(),
    sessionId: SESSION_ID,
  });
  return part?.type === "data-browserStatus" ? part.data.tabs : undefined;
}

beforeEach(() => {
  windowList = [];
  loaded = new Map();
  openedTabs = [];
});

describe("the tabs a session is told its chat has", () => {
  it("names a tab whose page is unloaded beside the loaded ones, by what the window keeps of it", async () => {
    windowList = [
      { id: "tab_up", kind: "page", title: "Stale", url: "https://stale/" },
      {
        id: "tab_unloaded",
        kind: "page",
        title: "Your Orders",
        url: "https://shop.example.com/orders",
      },
    ];
    loaded.set("tab_up", { title: "Inbox", url: "https://mail.example.com/" });
    openedTabs = [{ id: "tab_unloaded" }];

    expect(await tabsTold()).toEqual([
      { id: "tab_up", title: "Inbox", url: "https://mail.example.com/" },
      {
        id: "tab_unloaded",
        openedBy: "task",
        title: "Your Orders",
        unloaded: true,
        url: "https://shop.example.com/orders",
      },
    ]);
  });
});
