import { call, os } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { apps } from "./apps";

const mocks = vi.hoisted(() => ({
  canSaveKeys: vi.fn(() => true),
  appChanged: vi.fn(() => Promise.resolve()),
  /** The apps store, by slug: what each app's setup says and what it is called. */
  apps: new Map<string, { manifest: Record<string, unknown>; name: string }>(),
  beginMcpOAuth: vi.fn(),
  loadApp: vi.fn(),
  cancelMcpOAuth: vi.fn(() => Promise.resolve()),
  finishSignInCookies: vi.fn(() => Promise.resolve<object[]>([])),
  oauthState: undefined as string | undefined,
  pending: new Map<string, string>(),
  updates: new Set<string>(),
  recordConnection: vi.fn(),
  requireAppKeys: vi.fn(() => Promise.resolve([])),
  runAppTest: vi.fn(),
  startSignInCookies: vi.fn(),
  getAppCredentials: vi.fn((): object[] => []),
  setAppCredentials: vi.fn(),
  withAppMcpClient: vi.fn(),
}));

vi.mock("@/electron-main/rpc/base", () => ({
  base: os.errors({ API_ERROR: {}, NOT_FOUND: {}, UNAUTHORIZED: {} }),
}));
vi.mock("@/electron-main/lib/key-file", () => ({
  canSaveKeys: mocks.canSaveKeys,
  KEYS_NOT_SAVABLE: "no keyring",
}));
vi.mock("@/electron-main/auth/server", () => ({
  startAuthCallbackServer: () => Promise.resolve(),
}));
vi.mock("@/electron-main/stores/workspace/app-connections", () => ({
  appConnectionStore: {},
}));
vi.mock("@/electron-main/stores/workspace/app-credentials", () => ({
  getAppCredentials: mocks.getAppCredentials,
  setAppCredentials: mocks.setAppCredentials,
}));
vi.mock("@/electron-main/stores/workspace/app-oauth", () => ({
  appOAuthStore: {
    clearTransient: () => Promise.resolve(),
    getState: () => Promise.resolve(mocks.oauthState),
  },
}));
// The in-app browser's cookies, which this test has no browser for.
vi.mock("@/electron-main/browser-view/sign-in-cookies", () => ({
  dropSignInCookies: vi.fn(),
  finishSignInCookies: mocks.finishSignInCookies,
  startSignInCookies: mocks.startSignInCookies,
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
    // The apps store of a workspace this test has none of.
    loadApp: mocks.loadApp,
    beginMcpOAuth: mocks.beginMcpOAuth,
    cancelMcpOAuth: mocks.cancelMcpOAuth,
    isPendingAppUpdate: (state: string) => mocks.updates.has(state),
    pendingMcpOAuthSlug: (state: string) => mocks.pending.get(state),
    recordConnection: mocks.recordConnection,
    requireAppKeys: mocks.requireAppKeys,
    runAppTest: mocks.runAppTest,
    withAppMcpClient: mocks.withAppMcpClient,
  }),
);

// Nothing of the context is read on these paths.
const options = { context: {} as unknown as InitialRPCContext };

beforeEach(() => {
  mocks.loadApp.mockImplementation((slug: string) => {
    const app = mocks.apps.get(slug);
    return Promise.resolve(
      app
        ? {
            isErr: () => false,
            value: { ...app, manifestHash: `hash-of-${slug}`, slug },
          }
        : {
            error: { message: `No app is "${slug}".`, reason: "not-found" },
            isErr: () => true,
          },
    );
  });
  mocks.runAppTest.mockResolvedValue({ checks: [], passed: true, slug: "" });
  mocks.beginMcpOAuth.mockResolvedValue({
    isErr: () => false,
    value: { alreadyConnected: true },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.oauthState = undefined;
  mocks.pending.clear();
  mocks.updates.clear();
  mocks.apps.clear();
});

/** An app in the apps store, as `instrument app new` leaves one. */
function writeApp(
  name: string,
  slug: string,
  manifest: Record<string, unknown>,
) {
  mocks.apps.set(slug, { manifest, name });
  return Promise.resolve();
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
      {
        origin: "https://api.example.com",
        keys: [{ value: "k3y" }],
        slug: "keyed",
      },
      options,
    );

    expect(mocks.setAppCredentials).toHaveBeenCalledWith("keyed", [
      {
        origin: "https://api.example.com",
        savedAt: expect.any(Number) as number,
        value: "k3y",
      },
    ]);
  });

  it("refuses the key when the manifest points elsewhere than the card showed", async () => {
    await expect(
      call(
        apps.setCredential,
        {
          origin: "https://collector.example",
          keys: [{ value: "k3y" }],
          slug: "keyed",
        },
        options,
      ),
    ).rejects.toMatchObject({
      code: "API_ERROR",
      message:
        "The app now points at https://api.example.com instead of https://collector.example. Check the new address before going on.",
    });
    expect(mocks.setAppCredentials).not.toHaveBeenCalled();
    expect(mocks.runAppTest).not.toHaveBeenCalled();
  });

  it.each([
    { canSave: true, value: "k3y\u200B", why: /can’t be sent/ },
    { canSave: false, value: "k3y", why: /no keyring/ },
  ])(
    "stores nothing when refusing a key: $why",
    async ({ canSave, value, why }) => {
      mocks.canSaveKeys.mockReturnValueOnce(canSave);
      await expect(
        call(
          apps.setCredential,
          {
            origin: "https://api.example.com",
            keys: [{ value }],
            slug: "keyed",
          },
          options,
        ),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(why) as string,
      });
      expect(mocks.setAppCredentials).not.toHaveBeenCalled();
      mocks.canSaveKeys.mockReset().mockReturnValue(true);
    },
  );

  it("refuses a key under a label the setup does not name", async () => {
    await expect(
      call(
        apps.setCredential,
        {
          keys: [{ label: "Other", value: "k3y" }],
          origin: "https://api.example.com",
          slug: "keyed",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.setAppCredentials).not.toHaveBeenCalled();
  });
});

describe("replaceCredential", () => {
  const replace = () =>
    call(
      apps.replaceCredential,
      {
        key: { value: "n3w" },
        origin: "https://api.example.com",
        slug: "keyed",
      },
      options,
    );

  beforeEach(async () => {
    await writeApp("Keyed", "keyed", {
      auth: { kind: "bearer" },
      url: "https://api.example.com/v1",
      test: { path: "/me" },
      type: "api",
    });
  });

  it.each([
    { keyRefused: true, outcome: "refused" },
    { keyRefused: false, outcome: "failed" },
  ])("keeps the old key when the test has $outcome", async (test) => {
    mocks.runAppTest.mockResolvedValueOnce({
      checks: [],
      keyRefused: test.keyRefused,
      passed: false,
      slug: "keyed",
    });
    await expect(replace()).resolves.toEqual({ outcome: test.outcome });
    expect(mocks.setAppCredentials).not.toHaveBeenCalled();
  });

  it("keeps the new key once it has passed, tried before it is stored", async () => {
    mocks.runAppTest.mockImplementationOnce(() => {
      expect(mocks.setAppCredentials).not.toHaveBeenCalled();
      return Promise.resolve({ checks: [], passed: true, slug: "keyed" });
    });
    await expect(replace()).resolves.toEqual({ outcome: "replaced" });
    expect(mocks.runAppTest).toHaveBeenCalledWith(
      expect.objectContaining({ trying: [{ value: "n3w" }] }),
    );
    expect(mocks.setAppCredentials).toHaveBeenCalledOnce();
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

  it("records a sign-in that could not start", async () => {
    mocks.beginMcpOAuth.mockResolvedValue({
      error: { message: "no", reason: "connect" },
      isErr: () => true,
    });

    await expect(
      call(
        apps.startOAuth,
        { origin: "https://mcp.example.com", slug: "signed-in" },
        options,
      ),
    ).rejects.toMatchObject({ code: "API_ERROR" });
    expect(mocks.recordConnection.mock.calls).toEqual([
      ["signed-in", { error: "no", status: "failed" }],
    ]);
  });

  it("answers a service that will not take Instrument as refused, without an error", async () => {
    mocks.beginMcpOAuth.mockResolvedValue({
      error: { message: "no", reason: "client-refused" },
      isErr: () => true,
    });

    await expect(
      call(
        apps.startOAuth,
        { origin: "https://mcp.example.com", slug: "signed-in" },
        options,
      ),
    ).resolves.toEqual({ status: "refused" });
    expect(mocks.recordConnection.mock.calls).toEqual([
      ["signed-in", { ended: "refused", error: "no", status: "failed" }],
    ]);
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
    mocks.requireAppKeys.mockRejectedValueOnce(new Error("no key"));

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
    // Nothing went wrong, so the app goes back to needing its sign-in and the
    // chat is not woken.
    expect(mocks.recordConnection.mock.calls).toEqual([
      ["signed-in", { status: "needs-sign-in" }],
    ]);
    expect(mocks.appChanged).not.toHaveBeenCalled();
  });

  it("leaves an app connected when its update is stopped", async () => {
    mocks.oauthState = "open";
    mocks.pending.set("open", "gmail");
    mocks.updates.add("open");

    await call(apps.cancelOAuth, { slug: "gmail" }, options);

    expect(mocks.cancelMcpOAuth).toHaveBeenCalledWith("open");
    expect(mocks.recordConnection).not.toHaveBeenCalled();
    expect(mocks.appChanged).toHaveBeenCalledWith("gmail");
  });

  it("says nothing when no sign-in was waiting", async () => {
    await call(apps.cancelOAuth, { slug: "signed-in" }, options);

    expect(mocks.recordConnection).not.toHaveBeenCalled();
    expect(mocks.appChanged).not.toHaveBeenCalled();
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

  it("writes the other sites the sign-in left cookies on, the app's own left out", async () => {
    // Set up before the directory named Grok's sign-in page.
    await writeApp("Grok", "grok", { type: "web", url: "https://grok.com" });
    mocks.finishSignInCookies.mockResolvedValueOnce([
      { cookies: 7, site: "x.com" },
    ]);

    await call(
      apps.startWebSignIn,
      { loadsSignIn: true, slug: "grok", tab: "tab-1" },
      options,
    );
    await call(apps.markWebSignedIn, { slug: "grok" }, options);

    expect(mocks.startSignInCookies).toHaveBeenCalledWith("grok", "tab-1", {
      loadsSignIn: true,
    });
    // The directory's home and sign-in page with the app's own site.
    expect(mocks.finishSignInCookies).toHaveBeenCalledWith("grok", [
      "https://grok.com",
      "https://grok.com",
      "https://grok.com/sign-in",
    ]);
    expect(mocks.recordConnection).toHaveBeenCalledWith(
      "grok",
      expect.objectContaining({
        signInCookieSites: [{ cookies: 7, site: "x.com" }],
        status: "connected",
      }),
    );
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
