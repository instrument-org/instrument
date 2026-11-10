import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import { noteBrowserAgentActivity } from "../../lib/browser-agent-activity";
import { noteTabCommand } from "../../lib/tab-activity";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { browserTargetOf } from "../../types";
import { browser } from "./browser";

const CHAT = ChatIdSchema.parse("2026-11-08-shop");

/** The sessions the tests count as having a turn running. */
const working = new Set<string>();

vi.mock("../../lib/chat/activity", () => ({
  isWorking: (_chatId: unknown, sessionId?: string) =>
    sessionId !== undefined && working.has(sessionId),
}));

const context = {
  workspaceConfig: getWorkspaceConfig(),
  // The handler sends the workspace nothing.
  workspaceRef: {} as WorkspaceActorRef,
};

describe("browser.events.agentActivity", () => {
  it("answers for one session alone when asked, so a picture follows the tab that session drives", async () => {
    const tab = browserTargetOf(StoreId.newTabId());
    const mine = StoreId.newSessionId();
    const theirs = StoreId.newSessionId();
    noteTabCommand(tab, { chatId: CHAT, sessionId: mine }, 1000);
    const controller = new AbortController();
    const events = await call(
      browser.events.agentActivity,
      { sessionId: mine, targetId: tab },
      {
        context: {
          workspaceConfig: getWorkspaceConfig(),
          // The handler sends the workspace nothing.
          workspaceRef: {} as WorkspaceActorRef,
        },
        signal: controller.signal,
      },
    );
    const seen: (number | undefined)[] = [];
    const reading = (async () => {
      for await (const event of events) {
        seen.push(event.lastAt);
        if (seen.length === 2) {
          controller.abort();
        }
      }
    })().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Another session's command is no news for this one.
    noteTabCommand(tab, { chatId: CHAT, sessionId: theirs }, 2000);
    noteBrowserAgentActivity(tab);
    noteTabCommand(tab, { chatId: CHAT, sessionId: mine }, 3000);
    noteBrowserAgentActivity(tab);
    await reading;

    expect(seen).toEqual([1000, 3000]);
  });

  it("says a tab is in use only while a working session's latest command went to it", async () => {
    const first = browserTargetOf(StoreId.newTabId());
    const second = browserTargetOf(StoreId.newTabId());
    const finished = StoreId.newSessionId();
    const task = StoreId.newSessionId();
    working.add(task);
    // A task that has finished worked in the first tab, and the running one
    // is at work in it now.
    noteTabCommand(first, { chatId: CHAT, sessionId: finished }, 1000);
    noteTabCommand(first, { chatId: CHAT, sessionId: task }, 2000);
    const controller = new AbortController();
    const events = await call(
      browser.events.agentActivity,
      { targetId: first },
      { context, signal: controller.signal },
    );
    const seen: (boolean | undefined)[] = [];
    const reading = (async () => {
      for await (const event of events) {
        seen.push(event.inUse);
        if (seen.length === 2) {
          controller.abort();
        }
      }
    })().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The running task moves on to the second tab: the first is left with
    // only the finished task's work, which keeps no mark.
    noteTabCommand(second, { chatId: CHAT, sessionId: task }, 3000);
    noteBrowserAgentActivity(second);
    await reading;
    working.delete(task);

    expect(seen).toEqual([true, false]);
  });
});
