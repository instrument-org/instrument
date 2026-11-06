import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type WorkspaceAppsConfig } from "../../types";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { recordConnection } from "./connection";
import { type AppManifest, AppSlugSchema } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";
import { type McpOAuthStore } from "./mcp/oauth-provider";
import { withAppMcpClient } from "./mcp/run";
import { SignInAgainError } from "./mcp/tool-auth";
import { checkAppSignIns, noteSignInLost, signInLost } from "./sign-in-lost";
import { loadApp, writeAppFolder } from "./store";

vi.mock("./mcp/run", () => ({ withAppMcpClient: vi.fn() }));

const originalApps = getWorkspaceConfig().apps;

const oauthMcp: AppManifest = {
  auth: { kind: "oauth" },
  type: "mcp",
  url: "https://mcp.example.com/mcp",
};

const keyedMcp: AppManifest = {
  auth: { kind: "bearer" },
  type: "mcp",
  url: "https://mcp.example.com/mcp",
};

function emptyOAuthStore(): McpOAuthStore {
  return {
    clearClientInformation: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    clearTransient: () => Promise.resolve(),
    getClientInformation: () => Promise.resolve(undefined),
    getCodeVerifier: () => Promise.resolve(undefined),
    getState: () => Promise.resolve(undefined),
    getTokens: () => Promise.resolve(undefined),
    saveClientInformation: () => Promise.resolve(),
    saveCodeVerifier: () => Promise.resolve(),
    saveState: () => Promise.resolve(),
    saveTokens: () => Promise.resolve(),
  };
}

function useApps(apps: WorkspaceAppsConfig) {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
}

async function writeConnectedApp(slug: string, manifest: AppManifest) {
  await writeAppFolder({
    appsDir: getWorkspaceConfig().appsDir,
    guide: "A service.\n",
    manifest,
    name: slug,
    slug: AppSlugSchema.parse(slug),
  });
  const app = await loadApp(getWorkspaceConfig().appsDir, slug);
  await recordConnection(slug, {
    connectedAt: 1000,
    manifestHash: app._unsafeUnwrap().manifestHash,
    status: "connected",
  });
}

beforeEach(() => {
  useApps({
    ...createMemoryAppsConfig(),
    oauth: {
      redirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
      relayRedirectUrl: (service) =>
        `https://api.example/oauth/${service}/callback`,
      relayTokenUrl: (service) => `https://api.example/oauth/${service}/token`,
      store: emptyOAuthStore(),
    },
  });
});

afterEach(() => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
  vi.mocked(withAppMcpClient).mockReset();
});

describe("signInLost", () => {
  it.each([
    [
      "a refused refresh",
      { cause: new SignInAgainError("x"), reason: "unauthorized" },
      true,
    ],
    ["unauthorized after the refresh", { reason: "unauthorized" }, true],
    ["a server that is not there", { reason: "connect" }, false],
    ["a forbidden answer", { reason: "forbidden" }, false],
  ])("on %s", (_, failure, lost) => {
    expect(signInLost(oauthMcp, failure)).toBe(lost);
  });

  it("never applies to an app that takes a key", () => {
    expect(signInLost(keyedMcp, { reason: "unauthorized" })).toBe(false);
  });
});

describe("noteSignInLost", () => {
  it("moves a connected app to needing its sign-in and keeps when it connected", async () => {
    await writeConnectedApp("notion", oauthMcp);

    await noteSignInLost("notion");

    expect(
      await getWorkspaceConfig().apps.connections.get("notion"),
    ).toMatchObject({
      connectedAt: 1000,
      manifestHash: undefined,
      status: "needs-sign-in",
    });
  });

  it("leaves an app that was never connected as it stands", async () => {
    await recordConnection("notion", { status: "declined" });

    await noteSignInLost("notion");

    expect(
      await getWorkspaceConfig().apps.connections.get("notion"),
    ).toMatchObject({
      status: "declined",
    });
  });
});

describe("checkAppSignIns", () => {
  it("writes down the apps whose sign-in the server refuses, and only those", async () => {
    await writeConnectedApp("refused", oauthMcp);
    await writeConnectedApp("unreachable", oauthMcp);
    await writeConnectedApp("keyed", keyedMcp);
    vi.mocked(withAppMcpClient).mockImplementation(({ slug }) =>
      Promise.resolve(
        slug === "refused"
          ? err({
              cause: new SignInAgainError("x"),
              message: "401",
              reason: "unauthorized",
            })
          : slug === "unreachable"
            ? err({ message: "ECONNREFUSED", reason: "connect" })
            : ok([]),
      ),
    );

    const lost = await checkAppSignIns({
      appsDir: getWorkspaceConfig().appsDir,
    });

    expect(lost).toEqual(["refused"]);
    const connections = await getWorkspaceConfig().apps.connections.list();
    expect(connections["refused"]?.status).toBe("needs-sign-in");
    expect(connections["unreachable"]?.status).toBe("connected");
    expect(connections["keyed"]?.status).toBe("connected");
    // A keyed app is never asked: its key is the test's to judge.
    expect(
      vi.mocked(withAppMcpClient).mock.calls.map(([call]) => call.slug),
    ).toEqual(["refused", "unreachable"]);
  });
});
