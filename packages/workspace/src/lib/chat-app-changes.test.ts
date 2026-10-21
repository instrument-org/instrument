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
  detectChatAppChanges,
} from "./chat-app-changes";
import { DeviceIdSchema } from "./records/device-id";
import { ChatWrites } from "./chat-writes";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const MAC = DeviceIdSchema.parse("dev_MAC00000");
const PC = DeviceIdSchema.parse("dev_PC000000");

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

describe("detectChatAppChanges", () => {
  it("tells this computer's connections whole on the first message here, then nothing", async () => {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse("app-other-computer"),
    );
    const sessionId = StoreId.newSessionId();
    await ChatWrites.saveSession(
      { createdAt: new Date(), id: sessionId, title: "Test session" },
      chatId,
    );
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig(),
    });
    await writeAppFolder({
      appsDir: getWorkspaceConfig().appsDir,
      guide: "",
      manifest: {
        auth: { kind: "none" },
        type: "mcp",
        url: "https://mcp.example.com/mcp",
      },
      name: "Elsewhere",
      slug: AppSlugSchema.parse("elsewhere"),
    });
    // Told on another computer, where the app is connected; not connected on
    // this one.
    const here = await currentChatApps();
    const there = Object.fromEntries(
      Object.entries(here).map(([slug, app]) => [
        slug,
        { ...app, connected: true, device: MAC },
      ]),
    );
    await ChatWrites.saveMessageWithParts(baseline(sessionId, there), chatId);

    const detect = async () =>
      (
        await detectChatAppChanges({
          chatId,
          messageId: StoreId.newMessageId(),
          sessionId,
        })
      )._unsafeUnwrap();
    const first = await detect();
    expect(first?.type === "data-appEvent" && first.data).toMatchObject({
      apps: { elsewhere: { connected: false } },
      carried: true,
      events: [],
      otherComputer: true,
    });
    if (first?.type !== "data-appEvent") {
      throw new Error("expected an app note");
    }
    const id = first.metadata.messageId;
    await ChatWrites.saveMessageWithParts(
      {
        id,
        metadata: { createdAt: new Date(), sessionId },
        parts: [first],
        role: "user",
      },
      chatId,
    );

    expect(await detect()).toBeUndefined();
  });
});

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
    // Connections are each computer's own, so one computer's against
    // another's is no change.
    [
      "no change of connection between two computers",
      {
        a: { connected: true, device: MAC, fingerprint: "a", name: "A" },
        b: { connected: false, device: MAC, fingerprint: "b", name: "B" },
      },
      {
        a: { connected: false, device: PC, fingerprint: "a", name: "A" },
        b: { connected: true, device: PC, fingerprint: "b", name: "B" },
      },
      [],
    ],
  ])("tells %s", (_case, before, after, expected) => {
    expect(appEventsBetween(before, after)).toEqual(expected);
  });
});
