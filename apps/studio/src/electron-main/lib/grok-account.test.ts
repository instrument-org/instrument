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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

let grok: typeof GrokAccountModule;
/** What the token endpoint answers, one per poll; the last repeats. */
let tokenAnswers: Response[];
const requests: { body: URLSearchParams; url: string }[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  stored = {};
  requests.length = 0;
  openExternal.mockReset();
  grok = await import("./grok-account");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const body =
        init?.body instanceof URLSearchParams
          ? init.body
          : new URLSearchParams();
      requests.push({ body, url });
      if (url === DEVICE_URL) {
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
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Grok sign-in", () => {
  it("polls past pending and slow_down, then saves the account", async () => {
    tokenAnswers = [
      json({ error: "authorization_pending" }, 400),
      json({ error: "slow_down" }, 400),
      json({
        access_token: "access-1",
        expires_in: 3600,
        id_token: idToken({ email: "grok@example.com", sub: "user-1" }),
        refresh_token: "refresh-1",
      }),
    ];
    const signingIn = grok.signInWithGrok();
    await vi.advanceTimersByTimeAsync(0);
    expect(openExternal).toHaveBeenCalledWith(
      "https://accounts.x.ai/device?user_code=ABCD-1234",
    );
    expect(grok.grokAccountStatus().pending?.userCode).toBe("ABCD-1234");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await signingIn).toEqual({ outcome: "signed-in" });
    const [device] = requests;
    expect(Object.fromEntries(device?.body ?? [])).toMatchInlineSnapshot(`
      {
        "client_id": "b1a00492-073a-47ea-816f-4c329264a828",
        "referrer": "instrument",
        "scope": "openid profile email offline_access grok-cli:access api:access",
      }
    `);
    expect(grok.grokAccountStatus()).toEqual({
      account: {
        email: "grok@example.com",
        label: "grok@example.com",
        state: "signed-in",
      },
    });
    expect(grok.grokAccountProviderConfigs()).toMatchObject([
      { apiKey: "access-1", id: "grok-account", type: "grok-account" },
    ]);
  });

  it("answers declined when the person says no on xAI's page", async () => {
    tokenAnswers = [json({ error: "access_denied" }, 400)];
    const signingIn = grok.signInWithGrok();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await signingIn).toEqual({ outcome: "declined" });
    expect(grok.grokAccountStatus()).toEqual({});
  });

  it("answers canceled when given up in the app", async () => {
    tokenAnswers = [json({ error: "authorization_pending" }, 400)];
    const signingIn = grok.signInWithGrok();
    await vi.advanceTimersByTimeAsync(0);
    grok.cancelGrokSignIn();
    expect(await signingIn).toEqual({ outcome: "canceled" });
    expect(grok.grokAccountStatus().pending).toBeUndefined();
  });
});

describe("Grok account refresh", () => {
  it("replaces an expired token before a request goes out", async () => {
    stored = {
      account: {
        accessToken: "old",
        email: "grok@example.com",
        expiresAt: Date.now() - 1,
        refreshToken: "refresh-1",
      },
    };
    tokenAnswers = [
      json({
        access_token: "new",
        expires_in: 3600,
        refresh_token: "refresh-2",
      }),
    ];
    await grok.refreshExpiredGrokTokens("grok-account");
    expect(stored.account).toMatchObject({
      accessToken: "new",
      email: "grok@example.com",
      refreshToken: "refresh-2",
    });
  });

  it("keeps the account, signed out, when xAI refuses the refresh token", async () => {
    stored = {
      account: {
        accessToken: "old",
        email: "grok@example.com",
        expiresAt: Date.now() - 1,
        refreshToken: "refresh-1",
      },
    };
    tokenAnswers = [json({ error: "invalid_grant" }, 400)];
    await grok.refreshExpiredGrokTokens();
    expect(grok.grokAccountStatus().account?.state).toBe("signed-out");
    expect(grok.grokAccountProviderConfigs()).toEqual([]);
  });

  it("waits on nothing for another provider's config", async () => {
    stored = {
      account: { accessToken: "old", expiresAt: 0, refreshToken: "refresh-1" },
    };
    await grok.refreshExpiredGrokTokens("some-other-config");
    expect(requests).toEqual([]);
  });
});
