import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serveRegisteredClient } from "../../../test/helpers/serve-registered-client";
import { applyServedAppCatalog, resetServedAppCatalog } from "../catalog";
import seed from "../catalog-seed.json";

import { type OriginBound } from "../origin-bound";
import {
  createMcpOAuthProvider,
  mcpSignInClient,
  type McpOAuthStore,
} from "./oauth-provider";
import { fetchForMcp } from "./fetch";

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

  it("leaves tokens another caller saved after this one read its own", async () => {
    const store = inMemoryStore();
    const first = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });
    await first.saveTokens({
      access_token: "at-1",
      refresh_token: "rt-1",
      token_type: "Bearer",
    });
    const second = createMcpOAuthProvider({
      ...base,
      openAuthorization: vi.fn(),
      store,
    });
    expect(await second.tokens()).toMatchObject({ refresh_token: "rt-1" });
    // The first caller's refresh rotated the token; the second's refresh with
    // rt-1 is refused, and the SDK invalidates what it read.
    await first.saveTokens({
      access_token: "at-2",
      refresh_token: "rt-2",
      token_type: "Bearer",
    });
    await second.invalidateCredentials?.("tokens");

    expect(await second.tokens()).toMatchObject({ refresh_token: "rt-2" });
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
  const relayTokenUrl = (service: string) =>
    `https://api.example/oauth/${service}/token`;

  afterEach(resetServedAppCatalog);

  it("leaves a service the directory gives no client on the loopback", () => {
    expect(
      mcpSignInClient({
        loopbackRedirectUrl,
        relayRedirectUrl,
        relayTokenUrl,
        serverUrl: "https://mcp.slack.com/mcp",
      }).clientId,
    ).toBeUndefined();
  });

  it.each(["https://mcp.slack.com/mcp", "https://mcp.slack.com/mcp/"])(
    "signs in to %s with the client the directory gives",
    (serverUrl) => {
      serveRegisteredClient("slack", "registered-slack-client");
      expect(
        mcpSignInClient({
          loopbackRedirectUrl,
          relayRedirectUrl,
          relayTokenUrl,
          serverUrl,
        }),
      ).toMatchInlineSnapshot(`
      {
        "clientId": "registered-slack-client",
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
        relayTokenUrl,
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
        relayTokenUrl,
        serverUrl: "https://mcp.slack.com/other",
      }).clientId,
    ).toBeUndefined();
  });
});

describe("a registered client whose secret our API holds", () => {
  const serverUrl = "https://gmailmcp.googleapis.com/mcp/v1";
  const loopbackRedirectUrl = "http://127.0.0.1:49200/auth/callback/app";
  const signIn = () =>
    mcpSignInClient({
      loopbackRedirectUrl,
      relayRedirectUrl: (service) =>
        `https://api.example/oauth/${service}/callback`,
      relayTokenUrl: (service) => `https://api.example/oauth/${service}/token`,
      serverUrl,
    });

  /** Google's discovery as it answers, and our API's token route. */
  function serveGoogle() {
    const tokenRequests: { body: Record<string, string>; url: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (
        url ===
        "https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1"
      ) {
        return Response.json({
          authorization_servers: ["https://accounts.google.com/"],
          resource: serverUrl,
          scopes_supported: [
            "https://mail.google.com/",
            "https://www.googleapis.com/auth/gmail.readonly",
          ],
        });
      }
      if (
        url ===
        "https://accounts.google.com/.well-known/oauth-authorization-server"
      ) {
        return Response.json({
          authorization_endpoint:
            "https://accounts.google.com/o/oauth2/v2/auth",
          code_challenge_methods_supported: ["S256"],
          issuer: "https://accounts.google.com",
          response_types_supported: ["code"],
          token_endpoint: "https://oauth2.googleapis.com/token",
        });
      }
      if (url === "https://api.example/oauth/gmail/token") {
        tokenRequests.push({
          body: Object.fromEntries(
            new URLSearchParams(
              init?.body instanceof URLSearchParams ? init.body : "",
            ),
          ),
          url,
        });
        return Response.json({
          access_token: "at",
          expires_in: 3599,
          refresh_token: "rt",
          token_type: "Bearer",
        });
      }
      return new Response(null, { status: 404 });
    });
    return tokenRequests;
  }

  beforeEach(() => {
    // A hosted server whose client asks for its own scopes and page
    // parameters, as a directory serving one would give it.
    const served = {
      ...seed,
      entries: seed.entries.map((entry) =>
        entry.slug === "gmail"
          ? {
              ...entry,
              interfaces: [
                {
                  auth: "oauth-client",
                  authorizationParams: {
                    access_type: "offline",
                    prompt: "consent",
                  },
                  clientId:
                    "422213182201-4uoijqq6ij3r6ad8rgio6bhj2jhirim7.apps.googleusercontent.com",
                  endpoint: serverUrl,
                  format: "mcp",
                  name: "Gmail MCP server",
                  scope:
                    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
                  tokenExchange: "api",
                },
              ],
            }
          : entry,
      ),
    };
    expect(applyServedAppCatalog(served)).toBe("used");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServedAppCatalog();
  });

  it("takes the directory's scopes, page parameters, and token route", () => {
    expect(signIn()).toMatchInlineSnapshot(`
      {
        "authorizationParams": {
          "access_type": "offline",
          "prompt": "consent",
        },
        "clientId": "422213182201-4uoijqq6ij3r6ad8rgio6bhj2jhirim7.apps.googleusercontent.com",
        "redirectUrl": "https://api.example/oauth/gmail/callback",
        "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
        "statePrefix": "49200",
        "tokenExchange": {
          "serverUrl": "https://gmailmcp.googleapis.com/mcp/v1",
          "tokenUrl": "https://api.example/oauth/gmail/token",
        },
      }
    `);
  });

  it("asks for the directory's scopes and redeems and refreshes at our API", async () => {
    const tokenRequests = serveGoogle();
    const store = inMemoryStore();
    const openAuthorization = vi.fn<(url: URL) => void>();
    const provider = createMcpOAuthProvider({
      ...signIn(),
      openAuthorization,
      origin: new URL(serverUrl).origin,
      slug: "gmail",
      store,
    });

    expect(await auth(provider, { fetchFn: fetchForMcp, serverUrl })).toBe(
      "REDIRECT",
    );
    const page = openAuthorization.mock.calls[0]?.[0];
    expect(
      Object.fromEntries(
        [...(page?.searchParams ?? [])].filter(
          ([name]) => !["code_challenge", "state"].includes(name),
        ),
      ),
    ).toMatchInlineSnapshot(`
      {
        "access_type": "offline",
        "client_id": "422213182201-4uoijqq6ij3r6ad8rgio6bhj2jhirim7.apps.googleusercontent.com",
        "code_challenge_method": "S256",
        "prompt": "consent",
        "redirect_uri": "https://api.example/oauth/gmail/callback",
        "resource": "https://gmailmcp.googleapis.com/mcp/v1",
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
      }
    `);

    expect(
      await auth(provider, {
        authorizationCode: "the-code",
        fetchFn: fetchForMcp,
        serverUrl,
      }),
    ).toBe("AUTHORIZED");

    // A command builds its own provider, and refreshes through it.
    await store.saveTokens("gmail", {
      origin: new URL(serverUrl).origin,
      value: {
        ...(await provider.tokens()),
        access_token: "expired",
        token_type: "Bearer",
      },
    });
    const command = createMcpOAuthProvider({
      ...signIn(),
      openAuthorization: vi.fn(),
      origin: new URL(serverUrl).origin,
      slug: "gmail",
      store,
    });
    expect(await auth(command, { fetchFn: fetchForMcp, serverUrl })).toBe(
      "AUTHORIZED",
    );

    expect(
      tokenRequests.map(({ body }) => ({
        ...body,
        ...(body.code_verifier && { code_verifier: "<verifier>" }),
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "client_id": "422213182201-4uoijqq6ij3r6ad8rgio6bhj2jhirim7.apps.googleusercontent.com",
          "code": "the-code",
          "code_verifier": "<verifier>",
          "grant_type": "authorization_code",
          "redirect_uri": "https://api.example/oauth/gmail/callback",
          "resource": "https://gmailmcp.googleapis.com/mcp/v1",
        },
        {
          "client_id": "422213182201-4uoijqq6ij3r6ad8rgio6bhj2jhirim7.apps.googleusercontent.com",
          "grant_type": "refresh_token",
          "refresh_token": "rt",
          "resource": "https://gmailmcp.googleapis.com/mcp/v1",
        },
      ]
    `);
  });
});

describe("HubSpot's and Asana's registered clients", () => {
  const loopbackRedirectUrl = "http://127.0.0.1:49200/auth/callback/app";

  /** Each server's discovery as it answers, and our API's token route. */
  const vendors = {
    asana: {
      authorizationServer: {
        authorization_endpoint: "https://app.asana.com/-/oauth_authorize",
        code_challenge_methods_supported: ["S256"],
        issuer: "https://app.asana.com",
        response_types_supported: ["code"],
        token_endpoint: "https://app.asana.com/-/oauth_token",
        token_endpoint_auth_methods_supported: [
          "client_secret_post",
          "client_secret_basic",
        ],
      },
      authorizationServerUrl:
        "https://app.asana.com/.well-known/oauth-authorization-server",
      resource: {
        authorization_servers: ["https://app.asana.com"],
        resource: "https://mcp.asana.com/v2/mcp",
        scopes_supported: ["default"],
      },
      resourceUrl:
        "https://mcp.asana.com/.well-known/oauth-protected-resource/v2/mcp",
      // Asana lists one scope, so the SDK asks for it.
      opens: {
        page: "https://app.asana.com/-/oauth_authorize",
        params: {
          client_id: "asana-client",
          code_challenge_method: "S256",
          redirect_uri: "https://api.example/oauth/asana/callback",
          resource: "https://mcp.asana.com/v2/mcp",
          response_type: "code",
          scope: "default",
        },
      },
      serverUrl: "https://mcp.asana.com/v2/mcp",
    },
    hubspot: {
      authorizationServer: {
        authorization_endpoint: "https://mcp.hubspot.com/oauth/authorize/user",
        code_challenge_methods_supported: ["S256"],
        issuer: "https://mcp.hubspot.com",
        response_types_supported: ["code"],
        scopes_supported: [],
        token_endpoint: "https://mcp.hubspot.com/oauth/v3/token",
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      },
      authorizationServerUrl:
        "https://mcp.hubspot.com/.well-known/oauth-authorization-server",
      resource: {
        authorization_servers: ["https://mcp.hubspot.com"],
        resource: "https://mcp.hubspot.com",
        scopes_supported: [],
      },
      resourceUrl:
        "https://mcp.hubspot.com/.well-known/oauth-protected-resource",
      // HubSpot assigns the scopes at install and lists none, so none is sent.
      opens: {
        page: "https://mcp.hubspot.com/oauth/authorize/user",
        params: {
          client_id: "hubspot-client",
          code_challenge_method: "S256",
          redirect_uri: "https://api.example/oauth/hubspot/callback",
          resource: "https://mcp.hubspot.com",
          response_type: "code",
        },
      },
      serverUrl: "https://mcp.hubspot.com",
    },
  } as const;

  afterEach(() => {
    vi.restoreAllMocks();
    resetServedAppCatalog();
  });

  it.each(["hubspot", "asana"] as const)(
    "opens %s's own authorization page and redeems at our API",
    async (slug) => {
      const vendor = vendors[slug];
      serveRegisteredClient(slug, `${slug}-client`);
      const tokenUrls: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url === vendor.resourceUrl) {
          return Response.json(vendor.resource);
        }
        if (url === vendor.authorizationServerUrl) {
          return Response.json(vendor.authorizationServer);
        }
        if (url.endsWith("/token")) {
          tokenUrls.push(url);
          return Response.json({
            access_token: "at",
            refresh_token: "rt",
            token_type: "Bearer",
          });
        }
        return new Response(null, { status: 404 });
      });
      const { serverUrl } = vendor;
      const openAuthorization = vi.fn<(url: URL) => void>();
      const provider = createMcpOAuthProvider({
        ...mcpSignInClient({
          loopbackRedirectUrl,
          relayRedirectUrl: (service) =>
            `https://api.example/oauth/${service}/callback`,
          relayTokenUrl: (service) =>
            `https://api.example/oauth/${service}/token`,
          serverUrl,
        }),
        openAuthorization,
        origin: new URL(serverUrl).origin,
        slug,
        store: inMemoryStore(),
      });

      expect(await auth(provider, { fetchFn: fetchForMcp, serverUrl })).toBe(
        "REDIRECT",
      );
      const page = openAuthorization.mock.calls[0]?.[0];
      expect({
        page: `${page?.origin ?? ""}${page?.pathname ?? ""}`,
        params: Object.fromEntries(
          [...(page?.searchParams ?? [])].filter(
            ([name]) => !["code_challenge", "state"].includes(name),
          ),
        ),
      }).toEqual(vendor.opens);

      expect(
        await auth(provider, {
          authorizationCode: "the-code",
          fetchFn: fetchForMcp,
          serverUrl,
        }),
      ).toBe("AUTHORIZED");
      expect(tokenUrls).toEqual([`https://api.example/oauth/${slug}/token`]);
    },
  );
});
