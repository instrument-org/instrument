import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { noteBrowserAgentActivity } from "../../lib/browser-agent-activity";
import { noteTabCommand } from "../../lib/tab-activity";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { browserTargetOf } from "../../types";
import { browser } from "./browser";

const CHAT = ChatIdSchema.parse("2026-11-08-shop");

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
});
