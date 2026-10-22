import { call, os } from "@orpc/server";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { apps } from "./apps";

const mocks = vi.hoisted(() => ({
  appChanged: vi.fn(() => Promise.resolve()),
  beginMcpOAuth: vi.fn(),
  cancelMcpOAuth: vi.fn(() => Promise.resolve()),
  oauthState: undefined as string | undefined,
  pending: new Map<string, string>(),
  recordConnection: vi.fn(),
  requireAppCredential: vi.fn(() => Promise.resolve(null)),
  runAppTest: vi.fn(),
  setAppCredential: vi.fn(),
  withAppMcpClient: vi.fn(),
}));

vi.mock("@/electron-main/rpc/base", () => ({
  base: os.errors({ API_ERROR: {}, NOT_FOUND: {}, UNAUTHORIZED: {} }),
}));
vi.mock("@/electron-main/auth/server", () => ({
  startAuthCallbackServer: () => Promise.resolve(),
}));
vi.mock("@/electron-main/stores/workspace/app-connections", () => ({
  appConnectionStore: {},
}));
vi.mock("@/electron-main/stores/workspace/app-credentials", () => ({
  hasAppCredential: () => false,
  setAppCredential: mocks.setAppCredential,
}));
vi.mock("@/electron-main/stores/workspace/app-oauth", () => ({
  appOAuthStore: {
    clearTransient: () => Promise.resolve(),
    getState: () => Promise.resolve(mocks.oauthState),
  },
}));
vi.mock("../../lib/apps", () => ({
  announceConnected: vi.fn(),
  appOAuthRedirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
  appOAuthRelayUrl: (service: string) =>
    `https://api.example/oauth/${service}/callback`,
  appOAuthTokenUrl: (service: string) =>
    `https://api.example/oauth/${service}/token`,
  disconnectApp: vi.fn(),
}));
vi.mock(
  import("@instrument-org/workspace/electron"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    // What the workspace says to its lists and the chat, which has no
    // workspace to say it to here.
    appChanged: mocks.appChanged,
    beginMcpOAuth: mocks.beginMcpOAuth,
    cancelMcpOAuth: mocks.cancelMcpOAuth,
    pendingMcpOAuthSlug: (state: string) => mocks.pending.get(state),
    recordConnection: mocks.recordConnection,
    requireAppCredential: mocks.requireAppCredential,
    runAppTest: mocks.runAppTest,
    withAppMcpClient: mocks.withAppMcpClient,
  }),
);

let appsDir: string;
let options: { context: InitialRPCContext };

beforeEach(async () => {
  appsDir = await fs.mkdtemp(path.join(tmpdir(), "apps-route-"));
  // Only the apps directory is read on these paths.
  options = {
    context: { workspaceConfig: { appsDir } } as unknown as InitialRPCContext,
  };
  mocks.runAppTest.mockResolvedValue({ checks: [], passed: true, slug: "" });
  mocks.beginMcpOAuth.mockResolvedValue({
    isErr: () => false,
    value: { alreadyConnected: true },
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  mocks.oauthState = undefined;
  mocks.pending.clear();
  await fs.rm(appsDir, { force: true, recursive: true });
});

/** An app folder as the agent leaves it: the manifest over a guide. */
async function writeApp(
  name: string,
  slug: string,
  manifest: Record<string, unknown>,
) {
  const dir = path.join(appsDir, name);
  await fs.mkdir(dir, { recursive: true });
  // JSON is YAML, so each value goes in as it stands rather than through a
  // serializer this test would have to keep in step with the real one.
  const front = Object.entries({ id: slug, ...manifest })
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  await fs.writeFile(
    path.join(dir, "APP.md"),
    `---\n${front}\n---\n\nWhat the service is for.\n`,
  );
}

describe("setCredential", () => {
  beforeEach(async () => {
    await writeApp("Keyed", "keyed", {
      auth: { kind: "bearer" },
      url: "https://api.example.com/v1",
      test: { path: "/me" },
      type: "api",
    });
  });

  it("stores the key against the origin the card showed", async () => {
    await call(
      apps.setCredential,
      { origin: "https://api.example.com", slug: "keyed", value: "k3y" },
      options,
    );

    expect(mocks.setAppCredential).toHaveBeenCalledWith("keyed", {
      origin: "https://api.example.com",
      value: "k3y",
    });
  });

  it("refuses the key when the manifest points elsewhere than the card showed", async () => {
    await expect(
      call(
        apps.setCredential,
        { origin: "https://collector.example", slug: "keyed", value: "k3y" },
        options,
      ),
    ).rejects.toMatchObject({
      code: "API_ERROR",
      message:
        "The app now points at https://api.example.com instead of https://collector.example. Check the new address before going on.",
    });
    expect(mocks.setAppCredential).not.toHaveBeenCalled();
    expect(mocks.runAppTest).not.toHaveBeenCalled();
  });
});

describe("startOAuth", () => {
  beforeEach(async () => {
    await writeApp("Signed in", "signed-in", {
      auth: { kind: "oauth" },
      type: "mcp",
      url: "https://mcp.example.com/mcp",
    });
  });

  it("starts the sign-in at the origin the card showed", async () => {
    await expect(
      call(
        apps.startOAuth,
        { origin: "https://mcp.example.com", slug: "signed-in" },
        options,
      ),
    ).resolves.toEqual({ status: "connected" });
  });

  it("refuses to start when the manifest points elsewhere than the card showed", async () => {
    await expect(
      call(
        apps.startOAuth,
        { origin: "https://collector.example", slug: "signed-in" },
        options,
      ),
    ).rejects.toMatchObject({ code: "API_ERROR" });
    expect(mocks.beginMcpOAuth).not.toHaveBeenCalled();
  });
});

describe("inspect", () => {
  beforeEach(async () => {
    await writeApp("Signed in", "signed-in", {
      auth: { kind: "oauth" },
      type: "mcp",
      url: "https://mcp.example.com/mcp",
    });
    await writeApp("Keyed MCP", "keyed-mcp", {
      auth: { kind: "bearer" },
      type: "mcp",
      url: "https://mcp.example.com/mcp",
    });
  });

  it("asks for the sign-in again when the server refuses it, without reading as a fault", async () => {
    mocks.withAppMcpClient.mockResolvedValue({
      error: { message: "needs sign-in", reason: "unauthorized" },
      isErr: () => true,
    });

    await expect(
      call(apps.inspect, { slug: "signed-in" }, options),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.recordConnection).toHaveBeenCalledWith("signed-in", {
      error: "needs sign-in",
      status: "needs-sign-in",
    });
  });

  it("asks for a key when the stored one is gone, without reading as a fault", async () => {
    mocks.requireAppCredential.mockRejectedValueOnce(new Error("no key"));

    await expect(
      call(apps.inspect, { slug: "keyed-mcp" }, options),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.recordConnection).toHaveBeenCalledWith("keyed-mcp", {
      error: "no key",
      status: "needs-key",
    });
    expect(mocks.withAppMcpClient).not.toHaveBeenCalled();
  });

  it("keeps the sign-in when the server refuses a permission", async () => {
    mocks.withAppMcpClient.mockResolvedValue({
      error: { message: "HTTP 403: no API access", reason: "forbidden" },
      isErr: () => true,
    });

    await expect(
      call(apps.inspect, { slug: "signed-in" }, options),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "HTTP 403: no API access",
    });
    expect(mocks.recordConnection).not.toHaveBeenCalled();
  });

  it("leaves a server that cannot be reached connected", async () => {
    mocks.withAppMcpClient.mockResolvedValue({
      error: { message: "down", reason: "connect" },
      isErr: () => true,
    });

    await expect(
      call(apps.inspect, { slug: "signed-in" }, options),
    ).rejects.toMatchObject({ code: "API_ERROR" });
    expect(mocks.recordConnection).not.toHaveBeenCalled();
  });
});

describe("cancelOAuth", () => {
  it("wakes the chat with the way on when a waiting sign-in is stopped", async () => {
    mocks.oauthState = "open";
    mocks.pending.set("open", "signed-in");

    await call(apps.cancelOAuth, { slug: "signed-in" }, options);

    expect(mocks.cancelMcpOAuth).toHaveBeenCalledWith("open");
    expect(mocks.recordConnection.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "signed-in",
          {
            "ended": "canceled",
            "error": "The sign-in was stopped before it finished.",
            "status": "failed",
          },
        ],
      ]
    `);
    expect(mocks.appChanged.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "signed-in",
          {
            "detail": "The sign-in was stopped before it finished.",
            "ended": "canceled",
            "event": "failed",
          },
        ],
      ]
    `);
  });

  it("says nothing when no sign-in was waiting", async () => {
    await call(apps.cancelOAuth, { slug: "signed-in" }, options);

    expect(mocks.recordConnection).not.toHaveBeenCalled();
    expect(mocks.appChanged).not.toHaveBeenCalled();
  });
});

describe("signInOnWeb", () => {
  it("refuses an app that is not there", async () => {
    await expect(
      call(apps.signInOnWeb, { slug: "missing" }, options),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("markWebSignedIn", () => {
  it("records a web app as connected on its manifest and wakes the chat", async () => {
    await writeApp("Google Drive", "drive", {
      type: "web",
      url: "https://drive.google.com",
    });

    await call(apps.markWebSignedIn, { slug: "drive" }, options);

    expect(mocks.recordConnection).toHaveBeenCalledWith(
      "drive",
      expect.objectContaining({
        manifestHash: expect.any(String),
        status: "connected",
      }),
    );
    expect(mocks.appChanged).toHaveBeenCalledWith("drive", {
      event: "connected",
    });
  });

  it("refuses an app that is not a web app", async () => {
    await writeApp("Keyed", "keyed", {
      auth: { kind: "bearer" },
      url: "https://api.example.com/v1",
      test: { path: "/me" },
      type: "api",
    });

    await expect(
      call(apps.markWebSignedIn, { slug: "keyed" }, options),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.recordConnection).not.toHaveBeenCalled();
  });
});
