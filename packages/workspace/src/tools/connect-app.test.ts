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

async function ask(chatId: typeof LISBON) {
  const result = await runTool(ConnectApp, {
    chatId,
    input: {
      activity: "Connecting Linear",
      explanation: "To read issues",
      reason: "So I can read your issues.",
      slug: "linear",
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
      name: "Linear",
      slug: "linear",
      state: "connected",
    });
    expect(await readConnection("linear")).toEqual(connected);
  });
});
