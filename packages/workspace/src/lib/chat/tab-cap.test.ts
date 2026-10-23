import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type TabLifetime } from "../../machines/window-browser";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { CHAT_HIDDEN_TAB_CAP, type HeldTab } from "../../schemas/chat-state";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { type BrowserTargetId, browserTargetOf } from "../../types";
import { getChatState, setChatState } from "../chat-record";
import { chatDir } from "../record-folders";
import { closeTabsOverCap } from "./tab-cap";

const lifetimes = vi.hoisted(() => new Map<string, TabLifetime>());
const closes = vi.hoisted(() => [] as string[]);

vi.mock(import("../../machines/window-browser"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabLifetime: (targetId: BrowserTargetId) => lifetimes.get(targetId),
}));
vi.mock(import("./window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  askWindow: ({ action }: { action: { kind: string; tabId?: string } }) => {
    if (action.kind === "close" && action.tabId) {
      closes.push(action.tabId);
    }
    return Promise.resolve(undefined);
  },
}));

const TASK = StoreId.newSessionId();

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  lifetimes.clear();
  closes.length = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "tab-cap-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("tab-cap-test")),
  );
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** A tab out of sight for `minutes`, or on screen with none. */
function heldTab(
  minutes: null | number,
  extra: Partial<HeldTab> = {},
): HeldTab {
  const id = browserTargetOf(StoreId.newSessionId());
  lifetimes.set(id, {
    drawn: minutes === null,
    hiddenForMs: minutes === null ? null : minutes * 60_000,
    unloadsInMs: minutes === null ? null : 0,
  });
  return { id, inWindow: true, openedBy: "task", ...extra };
}

describe("closeTabsOverCap", () => {
  it("leaves a chat at the cap alone", async () => {
    const tabs = Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
      heldTab(i),
    );
    await setChatState(chatDir(chatId), { browserTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
  });

  it("closes the tab hidden longest past the cap, and keeps word of it for its driver", async () => {
    const oldest = heldTab(500, { driver: TASK });
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => heldTab(i)),
      oldest,
    ];
    await setChatState(chatDir(chatId), { browserTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([oldest.id]);
    const state = await getChatState(chatDir(chatId));
    expect(state.browserTabs.map((tab) => tab.id)).not.toContain(oldest.id);
    expect(state.closedTabs).toEqual([
      { driver: TASK, id: oldest.id, reason: "tabCap", url: "" },
    ]);
  });

  it("never counts or closes a handed tab, a tab on screen, or a page with no tab", async () => {
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) => heldTab(i)),
      heldTab(900, { openedBy: "handed" }),
      heldTab(null),
      heldTab(900, { inWindow: false }),
    ];
    await setChatState(chatDir(chatId), { browserTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([]);
  });

  it("closes an unloaded tab before any with a page", async () => {
    const unloaded: HeldTab = {
      id: browserTargetOf(StoreId.newSessionId()),
      inWindow: true,
      openedBy: "task",
    };
    const tabs = [
      ...Array.from({ length: CHAT_HIDDEN_TAB_CAP }, (_, i) =>
        heldTab(i + 1000),
      ),
      unloaded,
    ];
    await setChatState(chatDir(chatId), { browserTabs: tabs });

    await closeTabsOverCap(chatId);

    expect(closes).toEqual([unloaded.id]);
  });
});
