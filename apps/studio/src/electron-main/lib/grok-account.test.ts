import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as GrokAccountModule from "./grok-account";

let stored: Record<string, unknown> = {};

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => true },
  shell: { openExternal },
}));

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: true } }));

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceKeysDir: () => "/user-data/machine/default/keys",
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

vi.mock("@/electron-main/windows/foreground", () => ({
  focusAppWindow: vi.fn(),
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

const DEVICE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings";
const API_BASE_URL = "https://api.test";
const SETUP_URL = `${API_BASE_URL}/grok/sign-in-setup`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function jwt(claims: Record<string, unknown>) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

/** Tokens for one xAI account, named by its subject. */
function tokensFor(subject: string, email = `${subject}@example.com`) {
  return json({
    access_token: jwt({ principal_id: subject }),
    expires_in: 3600,
    id_token: jwt({ email, sub: subject }),
    refresh_token: `refresh-${subject}`,
  });
}

let grok: typeof GrokAccountModule;
/** What the token endpoint answers, one per poll; the last repeats. */
let tokenAnswers: Response[];
/** The subscription tier xAI names for the account asked about. */
let tier: null | string;
/** What our API serves for the sign-in setup; undefined fails the request. */
let servedSetup: unknown;
const requests: { body: URLSearchParams; url: string }[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  stored = { registrations: {} };
  requests.length = 0;
  openExternal.mockReset();
  tier = "SuperGrok";
  servedSetup = undefined;
  grok = await import("./grok-account");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const body =
        init?.body instanceof URLSearchParams
          ? init.body
          : new URLSearchParams();
      requests.push({ body, url });
      if (url === SETUP_URL) {
        return servedSetup === undefined
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(json(servedSetup));
      }
      if (url === DEVICE_URL || url.endsWith("/device/code")) {
        return Promise.resolve(
          json({
            device_code: "device-1",
            expires_in: 600,
            interval: 1,
            user_code: "ABCD-1234",
            verification_uri: "https://accounts.x.ai/device",
            verification_uri_complete:
              "https://accounts.x.ai/device?user_code=ABCD-1234",
          }),
        );
      }
      if (url === TOKEN_URL) {
        const answer =
          tokenAnswers.length > 1 ? tokenAnswers.shift() : tokenAnswers[0];
        return Promise.resolve(answer?.clone() ?? json({}, 500));
      }
      if (url === SETTINGS_URL) {
        return Promise.resolve(
          json({ subscription_tier_display: "SuperGrok Pro" }),
        );
      }
      if (url === USER_URL) {
        return Promise.resolve(
          json(tier === "<missing>" ? {} : { subscriptionTier: tier }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function signIn() {
  const signingIn = grok.signInWithGrok();
  await vi.advanceTimersByTimeAsync(10_000);
  return signingIn;
}

describe("Grok sign-in", () => {
  it("polls past pending and slow_down, then saves the account with its plan", async () => {
    tokenAnswers = [
      json({ error: "authorization_pending" }, 400),
      json({ error: "slow_down" }, 400),
      tokensFor("user-1"),
    ];
    const signingIn = grok.signInWithGrok();
    await vi.advanceTimersByTimeAsync(0);
    expect(openExternal).toHaveBeenCalledWith(
      "https://accounts.x.ai/device?user_code=ABCD-1234",
    );
    expect(grok.grokAccountsStatus().pending?.userCode).toBe("ABCD-1234");
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await signingIn;
    expect(result).toMatchObject({
      account: {
        label: "user-1@example.com",
        plan: "SuperGrok Pro",
        state: "signed-in",
      },
      outcome: "signed-in",
    });
    const device = requests.find((request) => request.url === DEVICE_URL);
    expect(Object.fromEntries(device?.body ?? [])).toMatchInlineSnapshot(`
      {
        "client_id": "b1a00492-073a-47ea-816f-4c329264a828",
        "referrer": "instrument",
        "scope": "openid profile email offline_access grok-cli:access api:access",
      }
    `);
    expect(grok.grokAccountProviderConfigs()).toMatchObject([
      { id: result.account?.id, type: "grok-account" },
    ]);
  });

  it("signs in to the client and issuer our API serves", async () => {
    vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", API_BASE_URL);
    servedSetup = {
      apiBaseURL: "https://api.x.ai/v1",
      clientId: "served-client",
      issuer: "https://auth.x.ai/oauth2",
      referrer: "instrument",
      scope: "openid offline_access api:access",
      userURL: USER_URL,
    };
    tokenAnswers = [tokensFor("user-1")];

    await signIn();

    const device = requests.find((request) => request.url === DEVICE_URL);
    expect(device?.body.get("client_id")).toBe("served-client");
    expect(device?.body.get("scope")).toBe("openid offline_access api:access");
  });

  it("refuses a served setup that points away from xAI", async () => {
    vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", API_BASE_URL);
    servedSetup = {
      apiBaseURL: "https://api.x.ai/v1",
      clientId: "served-client",
      issuer: "https://auth.example.com/oauth2",
      referrer: "instrument",
      scope: "openid",
      userURL: USER_URL,
    };
    tokenAnswers = [tokensFor("user-1")];

    await signIn();

    expect(requests.map((request) => request.url)).toContain(DEVICE_URL);
  });

  it("lets an account through when xAI's answer no longer names a plan", async () => {
    tier = "<missing>";
    tokenAnswers = [tokensFor("user-1")];

    const result = await signIn();

    expect(result.account?.state).toBe("signed-in");
    expect(grok.grokAccountProviderConfigs()).toHaveLength(1);
  });

  it("knows an account again when its token carries a claim of the wrong type", async () => {
    const tokens = () =>
      json({
        access_token: jwt({ principal_id: "user-x" }),
        expires_in: 3600,
        id_token: jwt({ email: null, sub: "user-x" }),
        refresh_token: "refresh-x",
      });
    tokenAnswers = [tokens()];
    const first = await signIn();
    tokenAnswers = [tokens()];
    const again = await signIn();

    expect(again.account?.id).toBe(first.account?.id);
    expect(grok.grokAccountsStatus().accounts).toHaveLength(1);
  });

  it("keeps an account with no subscription, says so, and lists none of its models", async () => {
    tier = null;
    tokenAnswers = [tokensFor("free")];

    const result = await signIn();

    expect(result.account?.state).toBe("no-subscription");
    expect(grok.grokAccountProviderConfigs()).toEqual([]);

    // Subscribed since: the next check lets the account through.
    tier = "SuperGrok";
    await grok.checkGrokSubscriptions();
    expect(grok.grokAccountsStatus().accounts[0]?.state).toBe("signed-in");
    expect(grok.grokAccountProviderConfigs()).toHaveLength(1);
  });

  it("holds several accounts, and signing in to one again updates it", async () => {
    tokenAnswers = [tokensFor("first")];
    const first = await signIn();
    tokenAnswers = [tokensFor("second")];
    await signIn();
    tokenAnswers = [tokensFor("first")];
    const again = await signIn();

    expect(again.account?.id).toBe(first.account?.id);
    expect(
      grok.grokAccountsStatus().accounts.map((account) => account.label),
    ).toEqual(["first@example.com", "second@example.com"]);
    expect(
      grok.grokAccountProviderConfigs().map((config) => config.displayName),
    ).toEqual(["first@example.com", "second@example.com"]);

    await grok.signOutOfGrok({ accountId: first.account?.id ?? "" });
    expect(
      grok.grokAccountsStatus().accounts.map((account) => account.label),
    ).toEqual(["second@example.com"]);
  });

  it("answers declined when the person says no on xAI's page", async () => {
    tokenAnswers = [json({ error: "access_denied" }, 400)];
    expect(await signIn()).toEqual({ outcome: "declined" });
    expect(grok.grokAccountsStatus().accounts).toEqual([]);
  });

  it("answers canceled when given up in the app", async () => {
    tokenAnswers = [json({ error: "authorization_pending" }, 400)];
    const signingIn = grok.signInWithGrok();
    await vi.advanceTimersByTimeAsync(0);
    grok.cancelGrokSignIn();
    expect(await signingIn).toEqual({ outcome: "canceled" });
    expect(grok.grokAccountsStatus().pending).toBeUndefined();
  });
});

describe("Grok account refresh", () => {
  function seed(overrides: Record<string, unknown> = {}) {
    stored = {
      registrations: {
        "account-1": {
          accessToken: "old",
          addedAt: 1,
          email: "grok@example.com",
          expiresAt: Date.now() - 1,
          id: "account-1",
          refreshToken: "refresh-1",
          subject: "user-1",
          tier: "SuperGrok",
          ...overrides,
        },
      },
    };
  }

  function account() {
    return (stored.registrations as Record<string, Record<string, unknown>>)[
      "account-1"
    ];
  }

  it("replaces an expired token before a request goes out", async () => {
    seed();
    tokenAnswers = [
      json({
        access_token: "new",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    ];
    await grok.refreshExpiredGrokTokens("account-1");
    expect(account()).toMatchObject({
      accessToken: "new",
      email: "grok@example.com",
      refreshToken: "refresh-2",
      tier: "SuperGrok",
    });
  });

  it("keeps the account, signed out, when xAI refuses the refresh token", async () => {
    seed();
    tokenAnswers = [json({ error: "invalid_grant" }, 400)];
    await grok.refreshExpiredGrokTokens();
    expect(grok.grokAccountsStatus().accounts[0]?.state).toBe("signed-out");
    expect(grok.grokAccountProviderConfigs()).toEqual([]);
  });

  it("waits on nothing for another provider's config", async () => {
    seed();
    await grok.refreshExpiredGrokTokens("some-other-config");
    expect(requests).toEqual([]);
  });
});

describe("spellTier", () => {
  it.each([
    ["XPremiumPlus", "X Premium Plus"],
    ["SuperGrokHeavy", "SuperGrok Heavy"],
    ["SuperGrok", "SuperGrok"],
  ])("spells %s as %s", (raw, spelled) => {
    expect(grok.spellTier(raw)).toBe(spelled);
  });
});
