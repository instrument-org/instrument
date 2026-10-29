import { beforeEach, describe, expect, it, vi } from "vitest";

import { readConnection } from "../lib/apps/connection";
import { type AppManifest } from "../lib/apps/manifest";
import { createMemoryAppsConfig } from "../lib/apps/memory-config";
import { loadApp, writeAppFolder } from "../lib/apps/store";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { ChatIdSchema } from "../schemas/chat-id";
import { AppSlugSchema } from "../lib/apps/manifest";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runTool } from "../test/helpers/run-tool";
import { ConnectApp } from "./connect-app";

// Every ask here comes from a chat's own session, where the card is seen.
vi.mock(import("../lib/chat/children"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionRole: () => "chat",
}));

const model = createMockAIGatewayModel();
const LISBON = ChatIdSchema.parse("2026-10-08-lisbon");
const PORTO = ChatIdSchema.parse("2026-10-09-porto");
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
  await writeAppFolder({
    appsDir: getWorkspaceConfig().appsDir,
    guide: "",
    manifest,
    name: "Linear",
    slug: AppSlugSchema.parse("linear"),
  });
});

async function ask(chatId: typeof LISBON, slugs = ["linear"]) {
  const result = await runTool(ConnectApp, {
    chatId,
    input: {
      activity: "Connecting Linear",
      explanation: "To read issues",
      reason: "So I can read your issues.",
      slugs,
    },
    model,
    signal: AbortSignal.timeout(10_000),
  });
  return result._unsafeUnwrap();
}

describe("connect_app", () => {
  it("keeps every chat that asks waiting on the answer", async () => {
    await ask(LISBON);
    await ask(PORTO);
    await ask(LISBON);

    expect(await readConnection("linear")).toMatchObject({
      status: "needs-sign-in",
      waitingChats: [LISBON, PORTO],
    });
  });

  it("answers that a connected app is connected, leaving its record alone", async () => {
    const connected = {
      connectedAt: 1,
      manifestHash: (
        await loadApp(getWorkspaceConfig().appsDir, "linear")
      )._unsafeUnwrap().manifestHash,
      status: "connected" as const,
      updatedAt: 1,
    };
    await getWorkspaceConfig().apps.connections.set("linear", connected);

    expect(await ask(LISBON)).toEqual({
      apps: [{ name: "Linear", slug: "linear", state: "connected" }],
    });
    expect(await readConnection("linear")).toEqual(connected);
  });

  it("puts every app it names on one card, waiting on each, and says why one was not asked", async () => {
    await writeAppFolder({
      appsDir: getWorkspaceConfig().appsDir,
      guide: "",
      manifest: { ...manifest, url: "https://mcp.notion.com/mcp" },
      name: "Notion",
      slug: AppSlugSchema.parse("notion"),
    });
    const output = await ask(LISBON, ["linear", "notion", "linear", "jira"]);

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
            "message": "No app is "jira": no APP.md in Apps/ gives that as its id. Write the app's folder first (\`instrument app new\`), then ask.",
            "slug": "jira",
            "state": "failure",
          },
        ],
      }
    `);
    expect(await readConnection("notion")).toMatchObject({
      status: "needs-sign-in",
      waitingChats: [LISBON],
    });
    expect(ConnectApp.toModelOutput({ input: INPUT, output, toolCallId: "1" }))
      .toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "One card asking the user to connect Linear (linear), Notion (notion) is in the conversation, a row for each. Your turn ended on it. You are woken once, when every row is answered, with a note saying which apps they connected, as which account where it is known, and which they skipped. Do not poll, and do not test before the note.
        - jira is not on the card and is not connected: No app is "jira": no APP.md in Apps/ gives that as its id. Write the app's folder first (\`instrument app new\`), then ask.
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
