import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AccessDeniedError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { getWorkspaceConfig, setWorkspaceConfig } from "../../workspace-config";
import { AppSlugSchema } from "../manifest";
import { createMemoryAppsConfig } from "../memory-config";
import { type OriginBound } from "../origin-bound";
import { writeApp } from "../store";
import {
  beginMcpOAuth,
  completeMcpOAuth,
  describeSignInFailure,
} from "./oauth-flow";
import { type McpOAuthStore } from "./oauth-provider";

describe("describeSignInFailure", () => {
  it("says a refused registration cannot start, with what the server said", () => {
    expect(
      describeSignInFailure(new ServerError("anything"), {
        error: "invalid_redirect_uri",
        said: "Redirect URI is not supported.",
        status: 400,
      }),
    ).toMatchInlineSnapshot(
      `"the server refuses to register Instrument as a client (HTTP 400, invalid_redirect_uri), as servers that take only clients they approved in advance do, so this sign-in cannot start. Approval is for Instrument's makers to ask for, not the user. The server said: Redirect URI is not supported."`,
    );
  });

  // A 403 from the MCP endpoint itself is not a refused registration.
  it("passes a 403 from the server's own endpoint through as it came", () => {
    expect(
      describeSignInFailure(
        new StreamableHTTPError(403, "Error POSTing to endpoint: no"),
      ),
    ).toMatchInlineSnapshot(
      `"HTTP 403: Streamable HTTP error: Error POSTing to endpoint: no"`,
    );
  });

  it("names the OAuth error code a server sent", () => {
    expect(
      describeSignInFailure(new AccessDeniedError("")),
    ).toMatchInlineSnapshot(`"OAuth access_denied"`);
  });
});

describe("a service that gives a sign-in and then refuses it", () => {
  const originalApps = getWorkspaceConfig().apps;
  const slug = "refuses-after";
  let server: http.Server | undefined;

  afterEach(() => {
    setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
    server?.closeAllConnections();
    server?.close();
  });

  it("says the sign-in worked, and asks for a new one on the next try", async () => {
    const origin = await serveRefusing((started) => {
      server = started;
    });
    const store = inMemoryStore();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig(),
    });
    await writeApp({
      guide: "",
      manifest: { auth: { kind: "oauth" }, type: "mcp", url: `${origin}/mcp` },
      name: "Refuses",
      slug: AppSlugSchema.parse(slug),
    });
    const begin = async () => {
      const begun = (
        await beginMcpOAuth({
          redirectUrl: "http://127.0.0.1:1/auth/callback/app",
          relayRedirectUrl: (service) =>
            `https://api.example/oauth/${service}/callback`,
          relayTokenUrl: (service) =>
            `https://api.example/oauth/${service}/token`,
          slug,
          store,
        })
      )._unsafeUnwrap();
      if (begun.alreadyConnected) {
        throw new Error("Expected a sign-in to start");
      }
      return begun;
    };

    const { state } = await begin();
    const completed = await completeMcpOAuth({ code: "the-code", state });
    expect(completed._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Signed in, but using the app then failed: HTTP 401: Streamable HTTP error: Server returned 401 after successful authentication"`,
    );

    const again = await begin();
    expect(new URL(again.authorizationUrl).pathname).toBe("/authorize");
  });
});

/** An MCP server that registers anyone, issues and refreshes tokens, and then takes none of them. */
async function serveRefusing(onServer: (server: http.Server) => void) {
  const server = http.createServer((req, res) => {
    const origin = `http://${req.headers.host ?? ""}`;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? "/", origin).pathname;
    if (path === "/mcp") {
      json(401, {});
    } else if (path.startsWith("/.well-known/oauth-protected-resource")) {
      json(200, {
        authorization_servers: [origin],
        resource: `${origin}/mcp`,
      });
    } else if (path.startsWith("/.well-known/oauth-authorization-server")) {
      json(200, {
        authorization_endpoint: `${origin}/authorize`,
        code_challenge_methods_supported: ["S256"],
        issuer: origin,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        token_endpoint: `${origin}/token`,
        token_endpoint_auth_methods_supported: ["none"],
      });
    } else if (path === "/register") {
      json(201, {
        client_id: "client",
        redirect_uris: ["http://127.0.0.1:1/auth/callback/app"],
      });
    } else if (path === "/token") {
      json(200, {
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
      });
    } else {
      json(404, {});
    }
  });
  onServer(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function inMemoryStore(): McpOAuthStore {
  let client: OriginBound<OAuthClientInformationFull> | undefined;
  let tokens: OriginBound<OAuthTokens> | undefined;
  let state: string | undefined;
  let verifier: string | undefined;
  const done = (): Promise<void> => Promise.resolve();
  return {
    clearClientInformation: () => {
      client = undefined;
      return done();
    },
    clearTokens: () => {
      tokens = undefined;
      return done();
    },
    clearTransient: () => {
      state = undefined;
      verifier = undefined;
      return done();
    },
    getClientInformation: () => Promise.resolve(client),
    getCodeVerifier: () => Promise.resolve(verifier),
    getState: () => Promise.resolve(state),
    getTokens: () => Promise.resolve(tokens),
    saveClientInformation: (_, info) => {
      client = info;
      return done();
    },
    saveCodeVerifier: (_, value) => {
      verifier = value;
      return done();
    },
    saveState: (_, value) => {
      state = value;
      return done();
    },
    saveTokens: (_, value) => {
      tokens = value;
      return done();
    },
  };
}
