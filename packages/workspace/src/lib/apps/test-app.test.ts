import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type WorkspaceAppsConfig } from "../../types";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type AppManifest, AppSlugSchema } from "./manifest";
import { createMemoryAppsConfig } from "./memory-config";
import { beginMcpOAuth } from "./mcp/oauth-flow";
import { type McpOAuthStore } from "./mcp/oauth-provider";
import { type OriginBound } from "./origin-bound";
import { loadApp, writeAppFolder } from "./store";
import { runAppTest } from "./test-app";

// Every server here is on loopback, which the request guard answers without a
// lookup; the resolver is mocked so the suite never reaches the network.
vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
}));

const KEY = "sekret-key-0123";
const ACCESS_TOKEN = "oauth-access-0123";

interface Recorder {
  /** The Authorization header of every request the server saw. */
  authorizations: (string | undefined)[];
  close: () => Promise<void>;
  origin: string;
}

const servers: Recorder[] = [];
const originalApps = getWorkspaceConfig().apps;

afterEach(async () => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/**
 * A loopback service that records what authenticated each request: an API
 * whose `/me` answers 200 to the key, or an MCP server that admits the OAuth
 * access token.
 */
async function serve(kind: "api" | "mcp"): Promise<Recorder> {
  const authorizations: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    authorizations.push(req.headers.authorization);
    if (kind === "api") {
      const ok =
        req.url === "/me" && req.headers.authorization === `Bearer ${KEY}`;
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }
    void (async () => {
      if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
        res.writeHead(404);
        res.end();
        return;
      }
      const mcp = new McpServer({ name: "mock", version: "1.0.0" });
      mcp.registerTool("ping", { description: "Ping" }, () => ({
        content: [{ text: "pong", type: "text" }],
      }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body: unknown =
        chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : undefined;
      await transport.handleRequest(req, res, body);
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  const recorder = {
    authorizations,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
    origin: `http://127.0.0.1:${address.port}`,
  };
  servers.push(recorder);
  return recorder;
}

function inMemoryOAuthStore(): McpOAuthStore {
  const clientInfo = new Map<string, OriginBound<OAuthClientInformationFull>>();
  const tokens = new Map<string, OriginBound<OAuthTokens>>();
  const transient = new Map<string, { state?: string; verifier?: string }>();
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
      transient.delete(slug);
      return Promise.resolve();
    },
    getClientInformation: (slug) => Promise.resolve(clientInfo.get(slug)),
    getCodeVerifier: (slug) => Promise.resolve(transient.get(slug)?.verifier),
    getState: (slug) => Promise.resolve(transient.get(slug)?.state),
    getTokens: (slug) => Promise.resolve(tokens.get(slug)),
    saveClientInformation: (slug, info) => {
      clientInfo.set(slug, info);
      return Promise.resolve();
    },
    saveCodeVerifier: (slug, verifier) => {
      transient.set(slug, { ...transient.get(slug), verifier });
      return Promise.resolve();
    },
    saveState: (slug, state) => {
      transient.set(slug, { ...transient.get(slug), state });
      return Promise.resolve();
    },
    saveTokens: (slug, saved) => {
      tokens.set(slug, saved);
      return Promise.resolve();
    },
  };
}

function useApps(apps: WorkspaceAppsConfig) {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
}

async function writeApp(slug: string, manifest: AppManifest) {
  await writeAppFolder({
    appsDir: getWorkspaceConfig().appsDir,
    guide: "# Service\n\nGET /me answers who the key belongs to.\n",
    manifest,
    slug: AppSlugSchema.parse(slug),
  });
}

function testApp(slug: string) {
  return runAppTest({
    appsDir: getWorkspaceConfig().appsDir,
    signal: AbortSignal.timeout(10_000),
    slug,
  });
}

describe("an API app's key", () => {
  let approved: Recorder;
  let elsewhere: Recorder;
  const slug = "keyed-api";

  beforeEach(async () => {
    approved = await serve("api");
    elsewhere = await serve("api");
    useApps(
      createMemoryAppsConfig({
        credentials: { [slug]: { origin: approved.origin, value: KEY } },
      }),
    );
  });

  const manifestAt = (baseUrl: string): AppManifest => ({
    auth: { kind: "bearer" },
    baseUrl,
    name: "Keyed",
    test: { path: "/me" },
    type: "api",
  });

  it("is sent to the origin it was saved for", async () => {
    await writeApp(slug, manifestAt(approved.origin));

    const report = await testApp(slug);

    expect(report.passed).toBe(true);
    expect(approved.authorizations).toEqual([`Bearer ${KEY}`]);
  });

  it("is not sent once the manifest points at another origin", async () => {
    await writeApp(slug, manifestAt(elsewhere.origin));

    const report = await testApp(slug);

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === "credential")).toEqual({
      detail: `The stored key was approved for ${approved.origin}, and this manifest would send it to ${elsewhere.origin}. A key only goes where the user gave it: ask for it again with connect_app.`,
      name: "credential",
      status: "fail",
    });
    expect(elsewhere.authorizations).toEqual([]);
    expect(await getWorkspaceConfig().apps.connections.get(slug)).toMatchObject(
      { status: "needs-key" },
    );
  });
});

describe("an MCP app's sign-in", () => {
  let approved: Recorder;
  let elsewhere: Recorder;
  let store: McpOAuthStore;
  const slug = "signed-in-mcp";

  beforeEach(async () => {
    approved = await serve("mcp");
    elsewhere = await serve("mcp");
    store = inMemoryOAuthStore();
    await store.saveTokens(slug, {
      origin: approved.origin,
      value: { access_token: ACCESS_TOKEN, token_type: "Bearer" },
    });
    useApps({
      ...createMemoryAppsConfig(),
      oauth: {
        redirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
        relayRedirectUrl: (service) =>
          `https://api.example/oauth/${service}/callback`,
        store,
      },
    });
  });

  const manifestAt = (origin: string): AppManifest => ({
    auth: { kind: "oauth" },
    name: "Signed in",
    type: "mcp",
    url: `${origin}/mcp`,
  });

  it("connects to the server it was obtained from", async () => {
    await writeApp(slug, manifestAt(approved.origin));

    const report = await testApp(slug);
    const begun = await beginMcpOAuth({
      appsDir: getWorkspaceConfig().appsDir,
      redirectUrl: "http://127.0.0.1:1/auth/callback/app",
      relayRedirectUrl: (service) =>
        `https://api.example/oauth/${service}/callback`,
      slug,
      store,
    });

    expect(report.passed).toBe(true);
    expect(begun._unsafeUnwrap()).toEqual({ alreadyConnected: true });
    expect(approved.authorizations).toContain(`Bearer ${ACCESS_TOKEN}`);
  });

  it("is not sent once the manifest points at another server", async () => {
    await writeApp(slug, manifestAt(elsewhere.origin));

    const report = await testApp(slug);
    const begun = await beginMcpOAuth({
      appsDir: getWorkspaceConfig().appsDir,
      redirectUrl: "http://127.0.0.1:1/auth/callback/app",
      relayRedirectUrl: (service) =>
        `https://api.example/oauth/${service}/callback`,
      slug,
      store,
    });

    expect(report.checks.find((check) => check.name === "credential")).toEqual({
      detail: `The stored sign-in was approved for ${approved.origin}, and this manifest would send it to ${elsewhere.origin}. A sign-in only goes where the user gave it: ask for it again with connect_app.`,
      name: "credential",
      status: "fail",
    });
    expect(begun.isOk() && begun.value.alreadyConnected).toBe(false);
    expect(elsewhere.authorizations).not.toContain(`Bearer ${ACCESS_TOKEN}`);
    expect(
      await getWorkspaceConfig().apps.connections.get(slug),
    ).not.toMatchObject({ status: "connected" });
  });
});

describe("a web app", () => {
  const slug = "drive-web";
  const manifest: AppManifest = {
    name: "Google Drive",
    type: "web",
    url: "https://drive.google.com",
  };

  beforeEach(() => {
    useApps(createMemoryAppsConfig());
  });

  it("fails until the user says they are signed in, and says how to ask", async () => {
    await writeApp(slug, manifest);

    const report = await testApp(slug);

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === "credential")).toEqual({
      detail:
        "The user has not said they are signed in to Google Drive. Ask them with connect_app: the card opens https://drive.google.com in Instrument's browser, and the app connects when they say they are signed in.",
      name: "credential",
      status: "fail",
    });
    expect(await getWorkspaceConfig().apps.connections.get(slug)).toMatchObject(
      { status: "needs-sign-in" },
    );
  });

  it("passes once the sign-in is recorded, saying it cannot check the session and how to work the site", async () => {
    const { apps } = getWorkspaceConfig();
    await writeApp(slug, manifest);
    const { manifestHash } = (
      await loadApp(getWorkspaceConfig().appsDir, slug)
    )._unsafeUnwrap();
    await apps.connections.set(slug, {
      connectedAt: 1,
      manifestHash,
      status: "connected",
      updatedAt: 1,
    });

    const report = await testApp(slug);

    expect(report.passed).toBe(true);
    expect(report.checks.find((check) => check.name === "canary"))
      .toMatchInlineSnapshot(`
        {
          "detail": "This test cannot check the session itself: whether the user is still signed in shows only when a page of the site loads. Work it in the browser: brief a task with https://drive.google.com (it opens the site in a tab of its own, where the sign-in holds), or hand it a tab already open there with \`task new --tab <id>\`. \`app call\` and \`app request\` do not reach a web app.",
          "name": "canary",
          "status": "skip",
        }
      `);
    expect(await apps.connections.get(slug)).toMatchObject({
      manifestHash,
      status: "connected",
    });
  });

  it("asks again once the manifest moves to another site", async () => {
    const { apps } = getWorkspaceConfig();
    await writeApp(slug, manifest);
    await apps.connections.set(slug, {
      manifestHash: "an-older-manifest",
      status: "connected",
      updatedAt: 1,
    });

    const report = await testApp(slug);

    expect(report.passed).toBe(false);
    expect(
      report.checks.find((check) => check.name === "credential")?.detail,
    ).toContain("The manifest changed since the user said they were signed in");
  });
});
