import { beforeEach, describe, expect, it, vi } from "vitest";

import { readConnection } from "../lib/apps/connection";
import { type AppManifest } from "../lib/apps/manifest";
import { createMemoryAppsConfig } from "../lib/apps/memory-config";
import { loadApp, writeApp } from "../lib/apps/store";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import {
  closeAsksOf,
  openPermissionAsks,
  signInOfCall,
} from "../lib/chat/asks";
import { openAsks } from "../lib/chat/open-asks";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { AppSlugSchema } from "../lib/apps/manifest";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runTool } from "../test/helpers/run-tool";
import { ChatWrites } from "../lib/chat-writes";
import { ConnectApp } from "./connect-app";

// Every ask here comes from a chat's own session, where the card is seen.
vi.mock(import("../lib/chat/children"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionRole: () => "chat",
}));

const model = createMockAIGatewayModel();
/** A chat someone has written in, and its own session, where the card goes. */
async function chat() {
  const sessionId = StoreId.newSessionId();
  return { chatId: await chatFor(sessionId), sessionId };
}
const INPUT = { reason: "So I can read your issues.", slugs: ["linear"] };
const manifest = {
  auth: { kind: "oauth" },
  type: "mcp",
  url: "https://mcp.linear.app/mcp",
} satisfies AppManifest;

beforeEach(async () => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    apps: {
      ...createMemoryAppsConfig(),
      oauth: {
        redirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
        relayRedirectUrl: (service) =>
          `https://api.example/oauth/${service}/callback`,
        relayTokenUrl: (service) =>
          `https://api.example/oauth/${service}/token`,
        store: {} as never,
      },
    },
  });
  await writeApp({
    guide: "",
    manifest,
    name: "Linear",
    slug: AppSlugSchema.parse("linear"),
  });
});

async function ask(
  { chatId, sessionId }: Awaited<ReturnType<typeof chat>>,
  slugs = ["linear"],
  partId = StoreId.newPartId(),
  signedIn?: string[],
) {
  const result = await runTool(ConnectApp, {
    chatId,
    partId,
    sessionId,
    input: {
      activity: "Connecting Linear",
      explanation: "To read issues",
      reason: "So I can read your issues.",
      slugs,
      ...(signedIn && { signedIn }),
    },
    model,
    signal: AbortSignal.timeout(10_000),
  });
  return result._unsafeUnwrap();
}

describe("connect_app", () => {
  it("puts a sign-in card up in every chat that asks, the newest in each", async () => {
    const lisbon = await chat();
    const porto = await chat();
    await ask(lisbon);
    await ask(porto);
    await ask(lisbon);

    expect(await readConnection("linear")).toMatchObject({
      status: "needs-sign-in",
    });
    // A sign-in is no permission card.
    expect(await openPermissionAsks(lisbon.chatId)).toEqual([]);
    for (const { chatId } of [lisbon, porto]) {
      expect(await openAsks(chatId)).toEqual([
        expect.objectContaining({
          apps: [{ name: "Linear", slug: "linear", standing: "waiting" }],
          here: true,
          kind: "sign-in",
        }),
      ]);
    }
  });

  it("asks for a local server's key once the server is allowed, and not before", async () => {
    const local = {
      auth: { envVar: "SERVICE_TOKEN", kind: "env" },
      package: "service-mcp",
      runtime: "node",
      type: "mcp-local",
    } satisfies AppManifest;
    await writeApp({
      guide: "",
      manifest: local,
      name: "Local",
      slug: AppSlugSchema.parse("local"),
    });
    const lisbon = await chat();
    expect(await ask(lisbon, ["local"])).toMatchObject({
      apps: [{ kind: "run", state: "asked" }],
    });

    const { manifestHash } = (await loadApp("local"))._unsafeUnwrap();
    await getWorkspaceConfig().apps.connections.set("local", {
      approvedManifestHash: manifestHash,
      status: "needs-key",
      updatedAt: 1,
    });
    expect(await ask(lisbon, ["local"])).toMatchObject({
      apps: [{ kind: "key", state: "asked" }],
    });
    expect(await readConnection("local")).toMatchObject({
      approvedManifestHash: manifestHash,
      status: "needs-key",
    });
  });

  it("names the computer whose call it is, still up or written past", async () => {
    const lisbon = await chat();
    const partId = StoreId.newPartId();
    await ask(lisbon, ["linear"], partId);

    expect(await signInOfCall(lisbon.chatId, partId)).toMatchObject({
      here: true,
      live: true,
    });
    await closeAsksOf(lisbon.chatId, undefined);
    expect(await signInOfCall(lisbon.chatId, partId)).toMatchObject({
      here: true,
      live: false,
    });
    expect(await signInOfCall(lisbon.chatId, StoreId.newPartId())).toBeNull();
  });

  it("answers that a connected app is connected, leaving its record alone", async () => {
    const connected = {
      connectedAt: 1,
      manifestHash: (await loadApp("linear"))._unsafeUnwrap().manifestHash,
      status: "connected" as const,
      updatedAt: 1,
    };
    await getWorkspaceConfig().apps.connections.set("linear", connected);

    const lisbon = await chat();
    expect(await ask(lisbon)).toEqual({
      apps: [{ name: "Linear", slug: "linear", state: "connected" }],
    });
    expect(await readConnection("linear")).toEqual(connected);
  });

  it("puts every app it names on one card, waiting on each, and says why one was not asked", async () => {
    await writeApp({
      guide: "",
      manifest: { ...manifest, url: "https://mcp.notion.com/mcp" },
      name: "Notion",
      slug: AppSlugSchema.parse("notion"),
    });
    const lisbon = await chat();
    const output = await ask(lisbon, ["linear", "notion", "linear", "jira"]);

    expect(output).toMatchInlineSnapshot(`
      {
        "apps": [
          {
            "kind": "sign-in",
            "name": "Linear",
            "site": "https://linear.app",
            "slug": "linear",
            "state": "asked",
          },
          {
            "kind": "sign-in",
            "name": "Notion",
            "site": "https://notion.com",
            "slug": "notion",
            "state": "asked",
          },
          {
            "message": "No app is "jira". \`instrument app list\` lists the apps set up here. Set the app up first (\`instrument app new\`), then ask.",
            "slug": "jira",
            "state": "failure",
          },
        ],
      }
    `);
    expect(await readConnection("notion")).toMatchObject({
      status: "needs-sign-in",
    });
    expect(
      (await openAsks(lisbon.chatId)).map((card) =>
        card.kind === "sign-in" ? card.apps.map((app) => app.slug) : [],
      ),
    ).toEqual([["linear", "notion"]]);
    expect(ConnectApp.toModelOutput({ input: INPUT, output, toolCallId: "1" }))
      .toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "One card asking the user to connect Linear (linear), Notion (notion) is in the conversation, a row for each. Your turn ended on it. You are woken once, when every row is answered, with a note saying which apps they connected, as which account where it is known, and which they skipped. Do not poll, and do not test before the note.
        - jira is not on the card and is not connected: No app is "jira". \`instrument app list\` lists the apps set up here. Set the app up first (\`instrument app new\`), then ask.
        The user cannot connect an app that is not on the card. Fix each one now and ask for it with connect_app on its own, or tell the user, in your line, that it is not connected and why.",
        }
      `);
  });

  it("reads a call that named one app as it always did", () => {
    const one = {
      kind: "sign-in",
      name: "Linear",
      slug: "linear",
      state: "asked",
    } as const;
    const said = (
      output: Parameters<typeof ConnectApp.toModelOutput>[0]["output"],
    ) => ConnectApp.toModelOutput({ input: INPUT, output, toolCallId: "1" });

    // A record from before a call could name several apps, and a call now.
    expect(said(one)).toEqual(said({ apps: [one] }));
    expect(said(one)).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "A card asking the user to sign in to Linear is in the conversation. Your turn ended on it: you will be woken with a note when they have signed in or declined, and the app connects on its own when they do. Do not poll, and do not test before the note.",
      }
    `);
  });
});

describe("connect_app for a web app", () => {
  beforeEach(async () => {
    await writeApp({
      guide: "",
      manifest: { type: "web", url: "https://www.amazon.com" },
      name: "Amazon",
      slug: AppSlugSchema.parse("amazon"),
    });
  });

  it("puts the card up for a site the chat has not opened", async () => {
    const lisbon = await chat();

    expect(await ask(lisbon, ["amazon"])).toMatchObject({
      apps: [{ kind: "web", slug: "amazon", state: "asked" }],
    });
  });

  it("records no sign-in the agent says it saw on a site the chat never opened", async () => {
    const lisbon = await chat();
    const output = await ask(lisbon, ["amazon"], undefined, ["amazon"]);

    expect(output).toMatchInlineSnapshot(`
      {
        "apps": [
          {
            "message": "This chat hasn't opened https://www.amazon.com, so "amazon" can't go in \`signedIn\`. Open it in a tab and look: if it loads signed in, call connect_app again with it in \`signedIn\`; if it loads signed out, ask for it in \`slugs\` alone.",
            "slug": "amazon",
            "state": "failure",
          },
        ],
      }
    `);
    expect(await openAsks(lisbon.chatId)).toEqual([]);
    expect(await readConnection("amazon")).toBe(undefined);
  });

  it("records a sign-in the agent saw on the site, with no card", async () => {
    const lisbon = await chat();
    await ChatWrites.sites(lisbon.chatId, lisbon.sessionId, ["www.amazon.com"]);
    const output = await ask(lisbon, ["amazon"], undefined, ["amazon"]);

    expect(output).toEqual({
      apps: [{ name: "Amazon", seen: true, slug: "amazon", state: "connected" }],
    });
    expect(await openAsks(lisbon.chatId)).toEqual([]);
    expect(await readConnection("amazon")).toMatchObject({
      manifestHash: (await loadApp("amazon"))._unsafeUnwrap().manifestHash,
      seenSignedIn: true,
      status: "connected",
    });
    expect(
      ConnectApp.toModelOutput({ input: INPUT, output, toolCallId: "1" }),
    ).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "Amazon is recorded as signed in on this computer; no card was shown. Carry on in its tab.",
      }
    `);
  });

  it("puts the card up for a site the chat opened that loaded signed out", async () => {
    const lisbon = await chat();
    await ChatWrites.sites(lisbon.chatId, lisbon.sessionId, ["amazon.com"]);

    expect(await ask(lisbon, ["amazon"])).toMatchObject({
      apps: [{ kind: "web", slug: "amazon", state: "asked" }],
    });
    expect(await readConnection("amazon")).toMatchObject({
      status: "needs-sign-in",
    });
  });
});
