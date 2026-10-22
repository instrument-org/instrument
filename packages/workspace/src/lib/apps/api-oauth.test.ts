import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serveRegisteredClient } from "../../test/helpers/serve-registered-client";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { performSignedInRequest } from "./api-oauth";
import { resetServedAppCatalog } from "./catalog";
import { type ApiAppManifest } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";
import { publisher } from "../../rpc/publisher";
import {
  beginMcpOAuth,
  completeMcpOAuth,
  PENDING_FLOW_TTL_MS,
} from "./mcp/oauth-flow";
import { type McpOAuthStore } from "./mcp/oauth-provider";
import { type OriginBound } from "./origin-bound";
import { setUpFromDirectory } from "./set-up";
import { loadApp } from "./store";

const MICROSOFT_CLIENT_ID = "eb827d4c-f05a-4857-be47-496124fa5c50";
const LOOPBACK = "http://127.0.0.1:49200/auth/callback/app";
const relayRedirectUrl = (service: string) =>
  `https://api.example/oauth/${service}/callback`;
const relayTokenUrl = (service: string) =>
  `https://api.example/oauth/${service}/token`;

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
    saveCodeVerifier: (slug, verifier) => {
      verifiers.set(slug, verifier);
      return Promise.resolve();
    },
    saveState: (slug, state) => {
      states.set(slug, state);
      return Promise.resolve();
    },
    saveTokens: (slug, saved) => {
      tokens.set(slug, saved);
      return Promise.resolve();
    },
  };
}

/**
 * Our API's token route for Outlook, which answers as Microsoft would once
 * it adds the secret, and Microsoft Graph's /me, which takes only the access
 * token `graph.accepts` names.
 */
function serveMicrosoft() {
  const graph = { accepts: "at-1", authorizations: [] as (null | string)[] };
  const tokenRequests: Record<string, string>[] = [];
  const refreshTokens = new Map([
    ["rt-1", { access_token: "at-2", refresh_token: "rt-2" }],
  ]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === "https://api.example/oauth/outlook/token") {
      const body = Object.fromEntries(
        new URLSearchParams(
          init?.body instanceof URLSearchParams ? init.body : "",
        ),
      );
      tokenRequests.push(body);
      // Our token route down, which says nothing about the sign-in itself.
      if (body.refresh_token === "rt-unreachable") {
        return new Response("Service Unavailable", { status: 503 });
      }
      const issued =
        body.grant_type === "authorization_code" && body.code === "the-code"
          ? { access_token: "at-1", refresh_token: "rt-1" }
          : body.grant_type === "refresh_token"
            ? refreshTokens.get(body.refresh_token ?? "")
            : undefined;
      return issued
        ? Response.json({
            ...issued,
            expires_in: 3599,
            ext_expires_in: 3599,
            scope:
              "Mail.ReadWrite Mail.Send Calendars.ReadWrite User.Read profile openid email",
            token_type: "Bearer",
          })
        : Response.json(
            {
              error: "invalid_grant",
              error_description: "AADSTS70000: The provided grant is invalid.",
            },
            { status: 400 },
          );
    }
    if (url === "https://graph.microsoft.com/v1.0/me") {
      const authorization = new Headers(init?.headers).get("authorization");
      graph.authorizations.push(authorization);
      return authorization === `Bearer ${graph.accepts}`
        ? Response.json({
            displayName: "Mac User",
            mail: "mac-user@outlook.com",
          })
        : Response.json(
            { error: { code: "InvalidAuthenticationToken" } },
            { status: 401 },
          );
    }
    return new Response(null, { status: 404 });
  });
  return { graph, refreshTokens, tokenRequests };
}

describe("an API app signed in with Instrument's Microsoft client", () => {
  const originalApps = getWorkspaceConfig().apps;
  let store: McpOAuthStore;

  beforeEach(() => {
    // Only admins are served the client for now; the seed carries the rest.
    serveRegisteredClient("outlook", MICROSOFT_CLIENT_ID);
    store = inMemoryStore();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: {
        ...createMemoryAppsConfig(),
        oauth: {
          redirectUrl: () => LOOPBACK,
          relayRedirectUrl,
          relayTokenUrl,
          store,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServedAppCatalog();
    setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
  });

  it("signs in through the relay, redeems and refreshes at our API, and calls Graph", async () => {
    const microsoft = serveMicrosoft();
    const { appsDir } = getWorkspaceConfig();

    const setUp = await setUpFromDirectory({ slug: "outlook" });
    if (setUp.kind !== "set-up") {
      throw new Error("Expected Outlook to be set up from the directory");
    }
    const { slug } = setUp;
    const app = (await loadApp(appsDir, slug))._unsafeUnwrap();
    const { manifest } = app;
    if (manifest.type !== "api") {
      throw new Error("Expected an API app");
    }
    expect(manifest).toEqual({
      auth: { kind: "oauth" },
      service: "outlook",
      test: { path: "/me" },
      type: "api",
      url: "https://graph.microsoft.com/v1.0",
    });
    expect(await getWorkspaceConfig().apps.connections.get(slug)).toMatchObject(
      { status: "needs-sign-in" },
    );

    const begun = (
      await beginMcpOAuth({
        appsDir,
        redirectUrl: LOOPBACK,
        relayRedirectUrl,
        relayTokenUrl,
        slug,
        store,
      })
    )._unsafeUnwrap();
    if (begun.alreadyConnected) {
      throw new Error("Expected a sign-in to start");
    }
    const page = new URL(begun.authorizationUrl);
    expect(`${page.origin}${page.pathname}`).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(begun.state).toMatch(/^49200\./);
    expect(page.searchParams.get("state")).toBe(begun.state);
    expect(
      Object.fromEntries(
        [...page.searchParams].filter(
          ([name]) => !["code_challenge", "state"].includes(name),
        ),
      ),
    ).toMatchInlineSnapshot(`
      {
        "client_id": "eb827d4c-f05a-4857-be47-496124fa5c50",
        "code_challenge_method": "S256",
        "prompt": "select_account",
        "redirect_uri": "https://api.example/oauth/outlook/callback",
        "response_type": "code",
        "scope": "offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite",
      }
    `);

    const completed = await completeMcpOAuth({
      code: "the-code",
      state: begun.state,
    });
    expect(completed._unsafeUnwrap()).toEqual({ opensIn: "app", slug });
    expect(await getWorkspaceConfig().apps.connections.get(slug)).toMatchObject(
      { status: "connected" },
    );
    expect(await store.getCodeVerifier(slug)).toBeUndefined();

    // An hour on, Graph refuses the first access token: the request refreshes
    // once and goes again.
    microsoft.graph.accepts = "at-2";
    const signed = await performSignedInRequest({
      body: undefined,
      manifest,
      method: "GET",
      params: {},
      path: "/me",
      signal: AbortSignal.timeout(5000),
      slug,
    });
    expect(signed.token).toBe("at-2");
    expect(signed.result._unsafeUnwrap().status).toBe(200);
    expect((await store.getTokens(slug))?.value).toMatchObject({
      access_token: "at-2",
      refresh_token: "rt-2",
    });
    expect(microsoft.graph.authorizations).toEqual([
      "Bearer at-1",
      "Bearer at-1",
      "Bearer at-2",
    ]);

    expect(
      microsoft.tokenRequests.map((body) => ({
        ...body,
        ...(body.code_verifier && { code_verifier: "<verifier>" }),
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "client_id": "eb827d4c-f05a-4857-be47-496124fa5c50",
          "code": "the-code",
          "code_verifier": "<verifier>",
          "grant_type": "authorization_code",
          "redirect_uri": "https://api.example/oauth/outlook/callback",
        },
        {
          "client_id": "eb827d4c-f05a-4857-be47-496124fa5c50",
          "grant_type": "refresh_token",
          "refresh_token": "rt-1",
        },
      ]
    `);
  });

  it("asks for a new sign-in once Microsoft refuses the refresh token", async () => {
    // A refresh token no other test spends, since fetchForMcp shares a
    // successful refresh of one token for a minute.
    const microsoft = serveMicrosoft();
    microsoft.graph.accepts = "at-none";
    const manifest = {
      auth: { kind: "oauth" },
      service: "outlook",
      test: { path: "/me" },
      type: "api",
      url: "https://graph.microsoft.com/v1.0",
    } satisfies ApiAppManifest;
    await store.saveTokens("outlook", {
      origin: "https://graph.microsoft.com",
      value: {
        access_token: "at-1",
        refresh_token: "rt-revoked",
        token_type: "Bearer",
      },
    });

    await expect(
      performSignedInRequest({
        body: undefined,
        manifest,
        method: "GET",
        params: {},
        path: "/me",
        signal: AbortSignal.timeout(5000),
        slug: "outlook",
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: This app needs the user to sign in again. Ask with connect_app; if that sign-in fails or is refused, sign in on the web instead: \`instrument app new outlook --web https://outlook.office.com --force\`, then connect_app.]`,
    );
    expect(await store.getTokens("outlook")).toBeUndefined();
  });

  it("keeps the sign-in and names the web when the token route is down", async () => {
    const microsoft = serveMicrosoft();
    microsoft.graph.accepts = "at-none";
    await store.saveTokens("outlook", {
      origin: "https://graph.microsoft.com",
      value: {
        access_token: "at-1",
        refresh_token: "rt-unreachable",
        token_type: "Bearer",
      },
    });

    await expect(
      performSignedInRequest({
        body: undefined,
        manifest: {
          auth: { kind: "oauth" },
          service: "outlook",
          test: { path: "/me" },
          type: "api",
          url: "https://graph.microsoft.com/v1.0",
        },
        method: "GET",
        params: {},
        path: "/me",
        signal: AbortSignal.timeout(5000),
        slug: "outlook",
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Refreshing outlook's sign-in failed: OAuth server_error: HTTP 503: Invalid OAuth error response: SyntaxError: Unexpected token 'S', "Service Unavailable" is not valid JSON. Raw body: Service Unavailable. Signing in again does not change this. Try again in a minute; if it keeps failing, sign in on the web instead: \`instrument app new outlook --web https://outlook.office.com --force\`, then connect_app.]`,
    );
    expect((await store.getTokens("outlook"))?.value.refresh_token).toBe(
      "rt-unreachable",
    );
  });

  it("lapses a sign-in nobody finishes, and tells the chat the web is next", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const heard: { name: string; slug: string }[] = [];
    const stop = publisher.subscribe("app.event", (event) => {
      heard.push(event);
    });
    try {
      const { appsDir } = getWorkspaceConfig();
      const setUp = await setUpFromDirectory({ slug: "outlook" });
      if (setUp.kind !== "set-up") {
        throw new Error("Expected Outlook to be set up from the directory");
      }
      const begun = (
        await beginMcpOAuth({
          appsDir,
          redirectUrl: LOOPBACK,
          relayRedirectUrl,
          relayTokenUrl,
          slug: setUp.slug,
          store,
        })
      )._unsafeUnwrap();
      if (begun.alreadyConnected) {
        throw new Error("Expected a sign-in to start");
      }
      await vi.advanceTimersByTimeAsync(PENDING_FLOW_TTL_MS);
      await vi.waitFor(() => {
        expect(heard).toHaveLength(1);
      });

      // Named by whichever Outlook this run set up, the directory's slug
      // being taken by the tests before it.
      expect(heard.map((event) => ({ ...event, name: "", slug: "" })))
        .toMatchInlineSnapshot(`
        [
          {
            "detail": "The sign-in page was left open without finishing, and the sign-in lapsed.",
            "event": "failed",
            "name": "",
            "signIn": {
              "ended": "expired",
              "web": "https://outlook.office.com",
            },
            "slug": "",
          },
        ]
      `);
      expect(
        await getWorkspaceConfig().apps.connections.get(setUp.slug),
      ).toMatchObject({ ended: "expired", status: "failed" });
      // The page coming back after the lapse finds nothing waiting.
      expect(
        (
          await completeMcpOAuth({ code: "the-code", state: begun.state })
        )._unsafeUnwrapErr().message,
      ).toMatch(/No pending sign-in/);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("never sends a sign-in to another origin than the one it was given for", async () => {
    const microsoft = serveMicrosoft();
    await store.saveTokens("outlook", {
      origin: "https://graph.microsoft.com",
      value: {
        access_token: "at-1",
        refresh_token: "rt-1",
        token_type: "Bearer",
      },
    });

    await expect(
      performSignedInRequest({
        body: undefined,
        manifest: {
          auth: { kind: "oauth" },
          service: "outlook",
          test: { path: "/me" },
          type: "api",
          url: "https://graph.example.com/v1.0",
        },
        method: "GET",
        params: {},
        path: "/me",
        signal: AbortSignal.timeout(5000),
        slug: "outlook",
      }),
    ).rejects.toThrow("sign in again");
    expect(microsoft.graph.authorizations).toEqual([]);
  });
});
