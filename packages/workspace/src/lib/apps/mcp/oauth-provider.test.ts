import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { describe, expect, it, vi } from "vitest";

import { type OriginBound } from "../origin-bound";
import {
  createMcpOAuthProvider,
  mcpSignInClient,
  type McpOAuthStore,
} from "./oauth-provider";

function inMemoryStore(): McpOAuthStore {
  const clientInfo = new Map<string, OriginBound<OAuthClientInformationFull>>();
  const tokens = new Map<string, OriginBound<OAuthTokens>>();
  const verifiers = new Map<string, string>();
  const states = new Map<string, string>();
  return {
    clearClientInformation: (slug) => {
      clientInfo.delete(slug);
      return Promise.resolve();
    },
    clearTokens: (slug) => {
      tokens.delete(slug);
      return Promise.resolve();
    },
    clearTransient: (slug) => {
      verifiers.delete(slug);
      states.delete(slug);
      return Promise.resolve();
    },
    getClientInformation: (slug) => Promise.resolve(clientInfo.get(slug)),
    getCodeVerifier: (slug) => Promise.resolve(verifiers.get(slug)),
    getState: (slug) => Promise.resolve(states.get(slug)),
    getTokens: (slug) => Promise.resolve(tokens.get(slug)),
    saveClientInformation: (slug, info) => {
      clientInfo.set(slug, info);
      return Promise.resolve();
    },
    saveCodeVerifier: (slug, v) => {
      verifiers.set(slug, v);
      return Promise.resolve();
    },
    saveState: (slug, s) => {
      states.set(slug, s);
      return Promise.resolve();
    },
    saveTokens: (slug, t) => {
      tokens.set(slug, t);
      return Promise.resolve();
    },
  };
}

describe("createMcpOAuthProvider", () => {
  const base = {
    origin: "https://mcp.linear.app",
    redirectUrl: "http://localhost:48757/auth/callback/app",
    slug: "linear",
  };

  it("advertises PKCE-capable public-client metadata with the redirect URL", () => {
    const provider = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store: inMemoryStore(),
    });
    expect(provider.redirectUrl).toBe(base.redirectUrl);
    expect(provider.clientMetadata.redirect_uris).toEqual([base.redirectUrl]);
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none");
    expect(provider.clientMetadata.grant_types).toContain("refresh_token");
  });

  it("round-trips client info, tokens, and the code verifier through the store", async () => {
    const store = inMemoryStore();
    const provider = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });

    await provider.saveClientInformation?.({
      client_id: "c1",
      redirect_uris: [base.redirectUrl],
    });
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "c1",
    });

    const tokens: OAuthTokens = {
      access_token: "at",
      refresh_token: "rt",
      token_type: "Bearer",
    };
    await provider.saveTokens(tokens);
    expect(await provider.tokens()).toEqual(tokens);

    await provider.saveCodeVerifier("verifier-123");
    expect(await provider.codeVerifier()).toBe("verifier-123");
  });

  it("hands tokens and client info only to a provider for the origin they were saved for", async () => {
    const store = inMemoryStore();
    const signedIn = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });
    await signedIn.saveTokens({ access_token: "at", token_type: "Bearer" });
    await signedIn.saveClientInformation?.({
      client_id: "c1",
      client_secret: "s1",
      redirect_uris: [base.redirectUrl],
    });

    const elsewhere = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      origin: "https://attacker.example",
      store,
    });
    expect(await elsewhere.tokens()).toBeUndefined();
    expect(await elsewhere.clientInformation()).toBeUndefined();

    const sameServer = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });
    expect(await sameServer.tokens()).toMatchObject({ access_token: "at" });
    expect(await sameServer.clientInformation()).toMatchObject({
      client_id: "c1",
    });
  });

  it("mints a fresh state each call (single-use CSRF token) and persists it", async () => {
    const store = inMemoryStore();
    const provider = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });
    const first = await provider.state?.();
    const second = await provider.state?.();
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
    // The store holds the most recent one (used to match the callback).
    expect(await store.getState("linear")).toBe(second);
  });

  it("invalidateCredentials clears tokens so a retry can re-authorize", async () => {
    const store = inMemoryStore();
    const provider = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });
    await provider.saveTokens({ access_token: "at", token_type: "Bearer" });
    await provider.saveClientInformation?.({
      client_id: "c1",
      redirect_uris: [base.redirectUrl],
    });
    await provider.invalidateCredentials?.("tokens");
    expect(await provider.tokens()).toBeUndefined();
    // Client registration is kept (only tokens were invalidated).
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "c1",
    });
  });

  it("throws a clear error when the code verifier is missing", async () => {
    const provider = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store: inMemoryStore(),
    });
    await expect(provider.codeVerifier()).rejects.toThrow(/verifier/i);
  });

  it("opens the authorization URL via the injected browser action", async () => {
    const openAuthorization = vi.fn();
    const provider = createMcpOAuthProvider({
      ...base,
      openAuthorization,
      store: inMemoryStore(),
    });
    const url = new URL("https://mcp.linear.app/authorize?x=1");
    await provider.redirectToAuthorization(url);
    expect(openAuthorization).toHaveBeenCalledWith(url);
  });

  it("uses a registered client as it stands and puts the prefix in front of the state", async () => {
    const store = inMemoryStore();
    const provider = createMcpOAuthProvider({
      ...base,
      clientId: "registered-id",
      openAuthorization: vi.fn(),
      statePrefix: "49200",
      store,
    });
    expect(await provider.clientInformation()).toEqual({
      client_id: "registered-id",
    });
    const state = await provider.state?.();
    expect(state).toMatch(/^49200\.[0-9a-f-]{36}$/);
    expect(await store.getState("linear")).toBe(state);
  });
});

describe("mcpSignInClient", () => {
  const loopbackRedirectUrl = "http://127.0.0.1:49200/auth/callback/app";
  const relayRedirectUrl = (service: string) =>
    `https://api.example/oauth/${service}/callback`;

  it.each(["https://mcp.slack.com/mcp", "https://mcp.slack.com/mcp/"])(
    "signs in to %s with Instrument's client through the relay",
    (serverUrl) => {
      expect(
        mcpSignInClient({ loopbackRedirectUrl, relayRedirectUrl, serverUrl }),
      ).toMatchInlineSnapshot(`
      {
        "clientId": "7844234082100.12310227817328",
        "redirectUrl": "https://api.example/oauth/slack/callback",
        "statePrefix": "49200",
      }
    `);
    },
  );

  it("leaves a server with no registered client on the loopback", () => {
    expect(
      mcpSignInClient({
        loopbackRedirectUrl,
        relayRedirectUrl,
        serverUrl: "https://mcp.linear.app/mcp",
      }),
    ).toMatchInlineSnapshot(`
      {
        "redirectUrl": "http://127.0.0.1:49200/auth/callback/app",
      }
    `);
  });

  it("never offers the client to another server on the same host", () => {
    expect(
      mcpSignInClient({
        loopbackRedirectUrl,
        relayRedirectUrl,
        serverUrl: "https://mcp.slack.com/other",
      }).clientId,
    ).toBeUndefined();
  });
});
