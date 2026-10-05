import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ChatGPTPlanModule from "./chatgpt-plan";

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

let plan: typeof ChatGPTPlanModule;
let tokenResponse: ReturnType<typeof deferred<Response>>;
const revoked: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  plan = await import("./chatgpt-plan");
  tokenResponse = deferred<Response>();
  revoked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
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
});

/** Starts the refresh that reading a nearly expired token sets off. */
function startRefresh() {
  plan.chatGPTPlanProviderConfigs();
}

describe("ChatGPT plan refresh", () => {
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
        .chatGPTPlanProviderConfigs()
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
          "cacheIdentifier": "chatgpt-plan-account-1",
          "displayName": "me@example.com",
          "id": "account-1",
        },
        {
          "apiKey": "access-work",
          "cacheIdentifier": "chatgpt-plan-account-2",
          "displayName": "me@example.com (2)",
          "id": "account-2",
        },
        {
          "apiKey": "access-other",
          "cacheIdentifier": "chatgpt-plan-account-3",
          "displayName": "other@example.com",
          "id": "account-3",
        },
      ]
    `);
  });

  it("names a lone account the plan, so its email stays out of the model picker", () => {
    stored = { registrations: { [personal.id]: personal } };

    expect(plan.chatGPTPlanProviderConfigs()[0]?.displayName).toBe(
      "ChatGPT plan",
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

    expect(plan.chatGPTPlanStatus()).toMatchInlineSnapshot(`
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
