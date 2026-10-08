import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ChatGPTAccountModule from "./chatgpt-account";

let stored: Record<string, unknown> = {};

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => true },
  shell: { openExternal },
}));

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: true } }));

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceSettingsDir: () => "/workspace/.instrument/settings",
}));

vi.mock("@/electron-main/lib/electron-logger", () => {
  const scoped = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  return { logger: { scope: () => scoped } };
});

vi.mock("@/electron-main/platform-api/headers", () => ({
  getAnonymousPlatformApiHeaders: () => ({ "user-agent": "Instrument/test" }),
}));

vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));

vi.mock("electron-store", () => ({
  default: class {
    delete(key: string) {
      // oxlint-disable-next-line typescript/no-dynamic-delete -- the in-memory stand-in for a keyed store
      delete stored[key];
    }
    get(key: string) {
      return stored[key];
    }
    onDidAnyChange() {
      // Nothing listens in these tests.
    }
    set(key: string, value: unknown) {
      stored[key] = value;
    }
  },
}));

const SUBJECT = "user-1";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const DISCOVERY_URL =
  "https://auth.openai.com/.well-known/openid-configuration";
const REVOKE_URL = "https://auth.openai.com/oauth/revoke";
const API_BASE_URL = "https://api.test";
const SETUP_URL = `${API_BASE_URL}/chatgpt/sign-in-setup`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const ACCOUNT_ID = "account-1";

function registration(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "access-1",
    addedAt: 1,
    clientId: "client-1",
    email: "user@example.com",
    expiresAt: Date.now() + 1000,
    id: ACCOUNT_ID,
    refreshToken: "refresh-1",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    subject: SUBJECT,
    ...overrides,
  };
}

/** An account whose access token is close enough to expiring that reading it starts a refresh. */
function seedAccount(overrides: Record<string, unknown> = {}) {
  stored = { registrations: { [ACCOUNT_ID]: registration(overrides) } };
}

function storedAccount(id = ACCOUNT_ID) {
  const registrations = stored.registrations as Record<
    string,
    Record<string, unknown>
  >;
  return registrations[id];
}

let plan: typeof ChatGPTAccountModule;
let tokenResponse: ReturnType<typeof deferred<Response>>;
const revoked: string[] = [];
// What our API answers for the sign-in setup; undefined fails the request.
let servedSetup: unknown;
let setupRequest: RequestInit | undefined;

beforeEach(async () => {
  vi.resetModules();
  plan = await import("./chatgpt-account");
  tokenResponse = deferred<Response>();
  revoked.length = 0;
  servedSetup = undefined;
  setupRequest = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === SETUP_URL) {
        setupRequest = init;
        return servedSetup === undefined
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(json(servedSetup));
      }
      if (url === TOKEN_URL) {
        return tokenResponse.promise;
      }
      if (url === DISCOVERY_URL) {
        return Promise.resolve(
          json({ issuer: "", jwks_uri: "", revocation_endpoint: REVOKE_URL }),
        );
      }
      if (url === REVOKE_URL) {
        const body =
          init?.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams();
        revoked.push(body.get("token") ?? "");
        return Promise.resolve(json({}));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Starts the refresh that reading a nearly expired token sets off. */
function startRefresh() {
  plan.chatGPTAccountProviderConfigs();
}

describe("ChatGPT account refresh", () => {
  it("saves the refreshed tokens onto the account it refreshed", async () => {
    seedAccount();
    startRefresh();
    tokenResponse.resolve(
      json({
        access_token: "access-2",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    );
    await vi.waitFor(() => {
      expect(storedAccount()?.refreshToken).toBe("refresh-2");
    });
  });

  it("revokes the token a refresh in flight brings back when signing out, and keeps none", async () => {
    seedAccount();
    startRefresh();
    const signedOut = plan.signOutOfChatGPT({ accountId: ACCOUNT_ID });
    tokenResponse.resolve(
      json({
        access_token: "access-2",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    );

    await expect(signedOut).resolves.toEqual({ revoked: true });
    expect(revoked).toEqual(["refresh-2"]);
    expect(storedAccount()).toBeUndefined();
  });

  it("does not overwrite a sign-in that landed while a refresh was out", async () => {
    seedAccount();
    startRefresh();
    // A sign-in to the same account replaces its grant meanwhile.
    seedAccount({
      accessToken: "access-fresh",
      expiresAt: Date.now() + 3_600_000,
      refreshToken: "refresh-fresh",
    });
    tokenResponse.resolve(
      json({
        access_token: "access-2",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    );
    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        TOKEN_URL,
        expect.anything(),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storedAccount()).toMatchObject({
      accessToken: "access-fresh",
      refreshToken: "refresh-fresh",
    });
  });

  it("hands out the replacement for an expired token once refreshExpiredTokens settles", async () => {
    seedAccount({ expiresAt: Date.now() - 1000 });
    const refreshed = plan.refreshExpiredTokens();
    tokenResponse.resolve(
      json({
        access_token: "access-2",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    );
    await refreshed;

    expect(plan.chatGPTAccountProviderConfigs()[0]?.apiKey).toBe("access-2");
  });

  it("waits on nothing for a config that is not a ChatGPT account", async () => {
    seedAccount({ expiresAt: Date.now() - 1000 });
    // The token endpoint never answers, so waiting on the account would hang.
    await plan.refreshExpiredTokens("openrouter-config");

    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      TOKEN_URL,
      expect.anything(),
    );
  });

  it("does not sign out a newer grant when a refresh of the old one is refused", async () => {
    seedAccount();
    startRefresh();
    seedAccount({ accessToken: "access-fresh", refreshToken: "refresh-fresh" });
    tokenResponse.resolve(json({ error: "refresh_token_reused" }, 400));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storedAccount()?.refreshToken).toBe("refresh-fresh");
  });
});

describe("several ChatGPT accounts", () => {
  const fresh = { expiresAt: Date.now() + 3_600_000 };
  const personal = registration({ ...fresh, email: "me@example.com" });
  const work = registration({
    ...fresh,
    accessToken: "access-work",
    addedAt: 2,
    clientId: "client-2",
    email: "me@example.com",
    id: "account-2",
    refreshToken: "refresh-work",
  });
  const other = registration({
    ...fresh,
    accessToken: "access-other",
    addedAt: 3,
    clientId: "client-3",
    email: "other@example.com",
    id: "account-3",
    subject: "user-2",
  });

  it("gives each account a config of its own, named by its email", () => {
    stored = {
      registrations: {
        [other.id]: other,
        [personal.id]: personal,
        [work.id]: work,
      },
    };

    expect(
      plan
        .chatGPTAccountProviderConfigs()
        .map(({ apiKey, cacheIdentifier, displayName, id }) => ({
          apiKey,
          cacheIdentifier,
          displayName,
          id,
        })),
    ).toMatchInlineSnapshot(`
      [
        {
          "apiKey": "access-1",
          "cacheIdentifier": "chatgpt-account-account-1",
          "displayName": "me@example.com",
          "id": "account-1",
        },
        {
          "apiKey": "access-work",
          "cacheIdentifier": "chatgpt-account-account-2",
          "displayName": "me@example.com (2)",
          "id": "account-2",
        },
        {
          "apiKey": "access-other",
          "cacheIdentifier": "chatgpt-account-account-3",
          "displayName": "other@example.com",
          "id": "account-3",
        },
      ]
    `);
  });

  it("names a lone account for ChatGPT, so its email stays out of the model picker", () => {
    stored = { registrations: { [personal.id]: personal } };

    expect(plan.chatGPTAccountProviderConfigs()[0]?.displayName).toBe(
      "ChatGPT account",
    );
  });

  it("lists every account, in the order they were added, with its state", () => {
    stored = {
      registrations: {
        [other.id]: registration({ ...other, scopes: ["openid"] }),
        [personal.id]: personal,
        [work.id]: registration({
          ...work,
          accessToken: undefined,
          refreshToken: undefined,
        }),
      },
    };

    expect(plan.chatGPTAccountsStatus()).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "email": "me@example.com",
            "id": "account-1",
            "label": "me@example.com",
            "state": "signed-in",
          },
          {
            "email": "me@example.com",
            "id": "account-2",
            "label": "me@example.com (2)",
            "state": "signed-out",
          },
          {
            "email": "other@example.com",
            "id": "account-3",
            "label": "other@example.com",
            "state": "plan-disabled",
          },
        ],
        "signingIn": false,
      }
    `);
  });

  it("signs out of one account and leaves the others signed in", async () => {
    stored = { registrations: { [personal.id]: personal, [work.id]: work } };

    await plan.signOutOfChatGPT({ accountId: work.id });

    expect(revoked).toEqual(["refresh-work"]);
    expect(storedAccount(work.id)).toBeUndefined();
    expect(storedAccount(personal.id)).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("refreshes one account without touching another's tokens", async () => {
    stored = {
      registrations: {
        [personal.id]: registration({ expiresAt: Date.now() + 1000 }),
        [work.id]: work,
      },
    };
    startRefresh();
    tokenResponse.resolve(
      json({
        access_token: "access-2",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    );

    await vi.waitFor(() => {
      expect(storedAccount(personal.id)?.refreshToken).toBe("refresh-2");
    });
    expect(storedAccount(work.id)).toMatchObject({
      accessToken: "access-work",
      refreshToken: "refresh-work",
    });
  });
});

describe("how a ChatGPT sign-in ends", () => {
  /** Starts a sign-in and answers with the state its authorize URL carries. */
  async function start() {
    openExternal.mockClear();
    const ended = plan.signInWithChatGPT({ callbackPort: 1455 });
    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalled();
    });
    const url = new URL(String(openExternal.mock.calls[0]?.[0]));
    return { ended, state: url.searchParams.get("state") ?? "" };
  }

  it("is declined when the person says no on OpenAI's page", async () => {
    stored = { registrations: {} };
    const { ended, state } = await start();
    void plan.receiveChatGPTCallback(
      new URLSearchParams({ error: "access_denied", state }),
    );
    await expect(ended).resolves.toEqual({ outcome: "declined" });
  });

  it("is canceled when given up in the app", async () => {
    stored = { registrations: {} };
    const { ended } = await start();
    plan.cancelChatGPTSignIn();
    await expect(ended).resolves.toEqual({ outcome: "canceled" });
  });

  it("is canceled when a newer sign-in takes its place", async () => {
    stored = { registrations: {} };
    const { ended } = await start();
    void plan.signInWithChatGPT({ callbackPort: 1455 });
    await expect(ended).resolves.toEqual({ outcome: "canceled" });
    plan.cancelChatGPTSignIn();
  });

  it("turns away a callback for some other attempt and keeps waiting for its own", async () => {
    stored = { registrations: {} };
    const { ended, state } = await start();
    expect(
      plan.receiveChatGPTCallback(
        new URLSearchParams({ code: "c", state: "not-this-one" }),
      ),
    ).toBeUndefined();
    expect(plan.receiveChatGPTCallback(new URLSearchParams())).toBeUndefined();
    void plan.receiveChatGPTCallback(
      new URLSearchParams({ error: "access_denied", state }),
    );
    await expect(ended).resolves.toEqual({ outcome: "declined" });
  });
});

describe("refreshDelayMs", () => {
  const now = 1_000_000_000;
  const minutes = (n: number) => n * 60_000;

  it.each([
    [
      "an hour left: five minutes before it expires",
      { expiresAt: now + minutes(60) },
      0,
      minutes(55),
    ],
    [
      "already inside the margin: a second",
      { expiresAt: now + minutes(1) },
      0,
      1000,
    ],
    [
      "the server's earliest time wins when later",
      { earliestRefreshAt: now + minutes(58), expiresAt: now + minutes(60) },
      0,
      minutes(58),
    ],
    ["one failure: two seconds", { expiresAt: now }, 1, 2000],
    ["four failures: sixteen seconds", { expiresAt: now }, 4, 16_000],
    [
      "many failures: capped at five minutes",
      { expiresAt: now },
      20,
      minutes(5),
    ],
    [
      "a failure never pulls a far-off refresh in",
      { expiresAt: now + minutes(60) },
      3,
      minutes(55),
    ],
  ])("%s", (_label, account, failures, expected) => {
    expect(plan.refreshDelayMs({ account, failures, now })).toBe(expected);
  });
});

describe("the sign-in setup our API serves", () => {
  const MOVED_TOKEN_URL = "https://auth.openai.com/api/v2/oauth/token";

  function servedWith(overrides: Record<string, unknown>) {
    return {
      authorizeUrl: "https://auth.openai.com/api/v2/authorize",
      discoveryUrl: DISCOVERY_URL,
      dynamicClientId: "dynamic_agent_client",
      issuer: "https://auth.openai.com",
      planScope: "chatgpt.tokens.use.direct",
      resource: "https://api.openai.com/v1",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      tokenUrl: MOVED_TOKEN_URL,
      ...overrides,
    };
  }

  /** Starts a sign-in and returns the authorize URL it opened. */
  async function authorizeURL() {
    openExternal.mockClear();
    void plan.signInWithChatGPT({ callbackPort: 1455 });
    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalled();
    });
    plan.cancelChatGPTSignIn();
    return new URL(String(openExternal.mock.calls[0]?.[0]));
  }

  beforeEach(() => {
    vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", API_BASE_URL);
    stored = { registrations: {} };
  });

  it("opens the authorize URL it serves, with its extra parameters, and keeps the app's own", async () => {
    servedSetup = servedWith({
      authorizeParams: { originator: "instrument", state: "not-ours" },
    });
    const url = await authorizeURL();
    expect(url.origin + url.pathname).toBe(
      "https://auth.openai.com/api/v2/authorize",
    );
    expect(url.searchParams.get("originator")).toBe("instrument");
    expect(url.searchParams.get("state")).not.toBe("not-ours");
    expect(url.searchParams.get("scope")).toBe(
      "openid chatgpt.tokens.use.direct",
    );
  });

  it("asks without the account token", async () => {
    servedSetup = servedWith({});
    await authorizeURL();
    expect(setupRequest?.headers).toEqual({ "user-agent": "Instrument/test" });
  });

  it("refuses a setup that points anywhere but OpenAI, and signs in with the built-in one", async () => {
    servedSetup = servedWith({
      authorizeUrl: "https://auth.openai.com.example/authorize",
    });
    const url = await authorizeURL();
    expect(url.origin + url.pathname).toBe(
      "https://auth.openai.com/api/accounts/authorize",
    );
    expect(stored.signInSetup).toBeUndefined();
  });

  it("signs in with the built-in setup when our API cannot be reached", async () => {
    const url = await authorizeURL();
    expect(url.origin + url.pathname).toBe(
      "https://auth.openai.com/api/accounts/authorize",
    );
  });

  it("refreshes tokens where the last served setup says, after a restart", async () => {
    stored = {
      registrations: { [ACCOUNT_ID]: registration() },
      signInSetup: servedWith({}),
    };
    const tokenURLs: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        tokenURLs.push(url);
        return Promise.resolve(
          json({ access_token: "access-2", expires_in: 3600 }),
        );
      }),
    );
    startRefresh();
    await vi.waitFor(() => {
      expect(storedAccount()?.accessToken).toBe("access-2");
    });
    expect(tokenURLs).toEqual([MOVED_TOKEN_URL]);
  });
});
