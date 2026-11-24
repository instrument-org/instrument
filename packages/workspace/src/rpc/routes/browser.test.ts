import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import { noteBrowserAgentActivity } from "../../lib/browser-agent-activity";
import { noteTabCommand } from "../../lib/tab-activity";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { browserTargetOf } from "../../types";
import { publisher } from "../publisher";
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

  it("marks every tab a running turn used, with its chat, until the turn ends", async () => {
    const first = browserTargetOf(StoreId.newTabId());
    const second = browserTargetOf(StoreId.newTabId());
    const finished = StoreId.newSessionId();
    const task = StoreId.newSessionId();
    const other = ChatIdSchema.parse("2026-11-08-other");
    // A turn that has ended used the second tab; a running task used the
    // first, then moves on to the second.
    noteTabCommand(second, { chatId: other, sessionId: finished }, 500);
    publisher.publish("session.done", { id: other, sessionId: finished });
    working.add(task);
    noteTabCommand(first, { chatId: CHAT, sessionId: task }, 1000);
    const read = async (targetId: typeof first) => {
      const controller = new AbortController();
      const events = await call(
        browser.events.agentActivity,
        { targetId },
        { context, signal: controller.signal },
      );
      for await (const event of events) {
        controller.abort();
        return { chat: event.chat, inUse: event.inUse };
      }
      return undefined;
    };

    expect(await read(second)).toEqual({ chat: undefined, inUse: false });
    noteTabCommand(second, { chatId: CHAT, sessionId: task }, 2000);
    // Moving on keeps the first: the turn may go back to it.
    expect(await read(first)).toEqual({ chat: CHAT, inUse: true });
    expect(await read(second)).toEqual({ chat: CHAT, inUse: true });

    publisher.publish("session.done", { id: CHAT, sessionId: task });
    working.delete(task);
    expect(await read(first)).toEqual({ chat: undefined, inUse: false });
  });
});

describe("browser.live.inUse", () => {
  it("names only the tab each working session is on, until its turn ends", async () => {
    const first = browserTargetOf(StoreId.newTabId());
    const second = browserTargetOf(StoreId.newTabId());
    const session = StoreId.newSessionId();
    working.add(session);
    const read = async () => {
      const controller = new AbortController();
      const events = await call(browser.live.inUse, undefined, {
        context,
        signal: controller.signal,
      });
      for await (const event of events) {
        controller.abort();
        return event;
      }
      return undefined;
    };

    noteTabCommand(first, { chatId: CHAT, sessionId: session }, 1000);
    expect(await read()).toEqual([{ chatId: CHAT, targetId: first }]);
    noteTabCommand(second, { chatId: CHAT, sessionId: session }, 2000);
    expect(await read()).toEqual([{ chatId: CHAT, targetId: second }]);
    publisher.publish("session.done", { id: CHAT, sessionId: session });
    expect(await read()).toEqual([]);
    working.delete(session);
  });
});
