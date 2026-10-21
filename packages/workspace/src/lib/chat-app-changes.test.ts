import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type ToldApps } from "../schemas/told";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { AppSlugSchema } from "./apps/manifest";
import { createMemoryAppsConfig } from "./apps/memory-config";
import { loadApp, writeAppFolder } from "./apps/store";
import {
  appEventsBetween,
  appWakeNote,
  currentChatApps,
} from "./chat-app-changes";
import { ChatWrites } from "./chat-writes";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/** A baseline that told the session of `apps`. */
function baseline(
  sessionId: StoreId.Session,
  apps: ToldApps,
): SessionMessage.ContextWithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  return {
    id,
    metadata: {
      agentName: "instrument",
      apps,
      createdAt,
      realRole: "user",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        state: "done",
        text: "<apps>…</apps>",
        type: "text",
      },
    ],
    role: "session-context",
  };
}

describe("appWakeNote", () => {
  it("tells every change since the session was last told, beside the answer", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("app-wake-note"));
    const sessionId = StoreId.newSessionId();
    await ChatWrites.saveSession(
      { createdAt: new Date(), id: sessionId, title: "Test session" },
      chatId,
    );
    const { appsDir } = getWorkspaceConfig();
    const apps = createMemoryAppsConfig();
    setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
    for (const [slug, name] of [
      ["wake-linear", "Linear"],
      ["wake-notion", "Notion"],
    ] as const) {
      await writeAppFolder({
        appsDir,
        guide: "",
        manifest: {
          auth: { kind: "none" },
          type: "mcp",
          url: "https://mcp.example.com/mcp",
        },
        name,
        slug: AppSlugSchema.parse(slug),
      });
    }
    const hashOf = async (slug: string) =>
      (await loadApp(appsDir, slug))._unsafeUnwrap().manifestHash;
    await apps.connections.set("wake-linear", {
      manifestHash: await hashOf("wake-linear"),
      status: "connected",
      updatedAt: 1,
    });
    await ChatWrites.saveMessageWithParts(
      baseline(sessionId, await currentChatApps()),
      chatId,
    );
    // Linear is disconnected in Settings, which wakes nobody; then the user
    // signs in to Notion from the chat's card.
    await apps.connections.remove("wake-linear");
    await apps.connections.set("wake-notion", {
      manifestHash: await hashOf("wake-notion"),
      status: "connected",
      updatedAt: 2,
    });

    const note = await appWakeNote({
      chatId,
      events: [{ event: "connected", name: "Notion", slug: "wake-notion" }],
      sessionId,
    });

    expect(note._unsafeUnwrap().events).toEqual([
      { event: "connected", name: "Notion", slug: "wake-notion" },
      { event: "disconnected", name: "Linear", slug: "wake-linear" },
    ]);
  });
});

describe("appEventsBetween", () => {
  it.each([
    [
      "an app taken away",
      { slack: { connected: true, fingerprint: "a", name: "Slack" } },
      {},
      [{ event: "removed", name: "Slack", slug: "slack" }],
    ],
    [
      "a connection lost",
      { linear: { connected: true, fingerprint: "a", name: "Linear" } },
      { linear: { connected: false, fingerprint: "a", name: "Linear" } },
      [{ event: "disconnected", name: "Linear", slug: "linear" }],
    ],
    [
      "a web app signed in",
      {
        drive: {
          connected: false,
          fingerprint: "a",
          name: "Drive",
          web: "https://drive.google.com",
        },
      },
      {
        drive: {
          connected: true,
          fingerprint: "a",
          name: "Drive",
          web: "https://drive.google.com",
        },
      },
      [
        {
          event: "connected",
          name: "Drive",
          slug: "drive",
          web: "https://drive.google.com",
        },
      ],
    ],
    // The conversation's own turns are told already (`appsToldByTurn`), so
    // one that turns up here was set up elsewhere.
    [
      "an app set up, not yet connected",
      {},
      { notion: { connected: false, fingerprint: "a", name: "Notion" } },
      [{ event: "added", name: "Notion", slug: "notion" }],
    ],
    [
      "an app whose folder changed",
      { linear: { connected: true, fingerprint: "a", name: "Linear" } },
      { linear: { connected: true, fingerprint: "b", name: "Linear" } },
      [{ event: "changed", name: "Linear", slug: "linear" }],
    ],
    [
      "nothing",
      { a: { connected: true, fingerprint: "a", name: "A" } },
      { a: { connected: true, fingerprint: "a", name: "A" } },
      [],
    ],
  ])("tells %s", (_case, before, after, expected) => {
    expect(appEventsBetween(before, after)).toEqual(expected);
  });
});
