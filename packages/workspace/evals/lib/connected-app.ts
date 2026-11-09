import http from "node:http";

import { AppManifestSchema, AppSlugSchema } from "../../src/lib/apps/manifest";
import { credentialOrigin } from "../../src/lib/apps/origin-bound";
import { loadApp, writeAppFolder } from "../../src/lib/apps/store";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type WorkspaceAppsConfig } from "../../src/types";
import { startMcpTracker } from "./mcp-tracker";

/** The access token a sign-in answered on a card leaves, which a `signed-out` app's server takes. */
export const SIGNED_IN_TOKEN = "stand-in";

/** A connected app a case wants to exist before it runs. */
export interface AppFixture {
  /** The account it is signed in as, as the manifest names it. */
  account?: string;
  /**
   * `api` (the default) serves the small REST tracker below; `mcp` serves
   * the larger issue tracker in `mcp-tracker.ts` over MCP; `web` is a site
   * the user said they are signed in to, at `url`, with no server at all;
   * `sign-in` is an app set up and not connected yet, which signs in
   * directly, for a case that has the agent ask for it (`signInsAnswerAs`);
   * `unfinished` is an API app whose setup stopped before its guide was
   * written, which `connect_app` refuses to put on a card; `signed-out` is
   * the MCP tracker, connected by a sign-in its server has stopped taking,
   * so every call is refused until the user signs in again on a card
   * (`signInsAnswerAs`).
   */
  kind?: "api" | "mcp" | "sign-in" | "signed-out" | "unfinished" | "web";
  /** What the user calls it, as the manifest carries it. */
  name: string;
  /**
   * For an `api` app, what it serves in place of the issue tracker: a stand-in
   * for a service a case needs, such as a mailbox or a store.
   */
  service?: StandInService;
  slug: string;
  /** For a web app, where it is worked. */
  url?: string;
  /**
   * For a `sign-in` app, who its server says the connection is signed in as.
   * With it, signing in reaches the MCP tracker with a `get_viewer` tool
   * answering this, and the sign-in learns no account of its own; without,
   * the app points nowhere and its sign-in names `you@example.com`.
   */
  viewer?: unknown;
}

/** A service an `api` app serves on loopback, described by its guide. */
export interface StandInService {
  /** The guide's opening line, saying what the service is. */
  about: string;
  /** The guide's endpoint list, a line each. */
  endpoints: string[];
  /**
   * The JSON body for a request, or `undefined` for a 404. A
   * `StandInStatus` answers with its own status, for a refusal the guide
   * describes. The request's query and its JSON body (`undefined` where it
   * sent none or one that does not parse) come third.
   */
  respond: (
    method: string,
    pathname: string,
    request: { body: unknown; query: URLSearchParams },
  ) => unknown;
}

/** A stand-in's answer with a status other than 200. */
export class StandInStatus {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

/** The request's body as JSON, or `undefined` for none or one that does not parse. */
async function jsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Stands up the apps a case declared: a real HTTP server on loopback, a real
 * manifest in the workspace's apps directory, and a connection on record, so
 * `instrument app request` goes end to end against something real.
 *
 * Loopback rather than a stub inside the process because the whole path is what
 * is being scored: the manifest gate, the connection check, and the request. A
 * fake that short-circuits any of those would pass a case the product would
 * fail.
 *
 * The server answers a small issue tracker, which is enough for a task to do
 * real work with and small enough to read in a transcript.
 */
export async function seedConnectedApps(
  fixtures: AppFixture[],
  { apps, appsDir }: { apps: WorkspaceAppsConfig; appsDir: string },
): Promise<{ close: () => Promise<void> }> {
  const servers: http.Server[] = [];
  const closers: (() => Promise<void>)[] = [];
  for (const fixture of fixtures) {
    if (fixture.kind === "web") {
      await writeApp(
        appsDir,
        fixture,
        {
          ...(fixture.account ? { account: fixture.account } : {}),
          type: "web",
          url: fixture.url ?? "https://example.invalid",
        },
        `Worked on the web${fixture.url === undefined ? "" : ` at ${fixture.url}`}.\n`,
      );
      await recordConnected(fixture.slug, { apps, appsDir });
      continue;
    }
    if (fixture.kind === "sign-in") {
      const tracker =
        fixture.viewer === undefined
          ? undefined
          : await startMcpTracker({ viewer: fixture.viewer });
      if (tracker) {
        closers.push(tracker.close);
      }
      await writeApp(
        appsDir,
        fixture,
        {
          auth: { kind: "oauth" },
          type: "mcp",
          url: tracker?.url ?? `https://${fixture.slug}.example.invalid/mcp`,
        },
        `${fixture.name}, set up and waiting for the user to sign in.\n`,
      );
      continue;
    }
    if (fixture.kind === "signed-out") {
      const store = apps.oauth?.store;
      if (store === undefined) {
        throw new Error(
          `${fixture.slug}: a signed-out app needs a case with signInsAnswerAs, which gives the run a sign-in store`,
        );
      }
      const tracker = await startMcpTracker({ accepts: SIGNED_IN_TOKEN });
      closers.push(tracker.close);
      const manifest = AppManifestSchema.parse({
        auth: { kind: "oauth" },
        type: "mcp",
        url: tracker.url,
      });
      await writeApp(
        appsDir,
        fixture,
        manifest,
        `${fixture.name} tracks the team's issues.\n`,
      );
      // What an earlier sign-in left: a registered client, and an access
      // token with nothing to refresh it by.
      const origin = credentialOrigin(manifest);
      await store.saveClientInformation(fixture.slug, {
        origin,
        value: {
          client_id: "stand-in-client",
          redirect_uris: [apps.oauth?.redirectUrl() ?? ""],
        },
      });
      await store.saveTokens(fixture.slug, {
        origin,
        value: { access_token: "lapsed", token_type: "Bearer" },
      });
      await recordConnected(fixture.slug, { apps, appsDir });
      continue;
    }
    if (fixture.kind === "unfinished") {
      await writeApp(
        appsDir,
        fixture,
        {
          auth: { kind: "bearer" },
          test: { path: "/me" },
          type: "api",
          url: `https://${fixture.slug}.example.invalid`,
        },
        // A prompt `app new` leaves in an API app's guide, still unanswered.
        "What this app is for, in a sentence or two.\n",
      );
      continue;
    }
    if (fixture.kind === "mcp") {
      const tracker = await startMcpTracker();
      closers.push(tracker.close);
      await writeApp(
        appsDir,
        fixture,
        {
          auth: { kind: "none" },
          type: "mcp",
          url: tracker.url,
        },
        `${fixture.name} tracks the team's issues.\n`,
      );
      await recordConnected(fixture.slug, { apps, appsDir });
      continue;
    }
    const { service } = fixture;
    const server = http.createServer((request, response) => {
      void (async () => {
        const url = request.url ?? "/";
        const method = request.method ?? "GET";
        const parsed = new URL(url, "http://stand-in");
        const answer = service
          ? url === "/health"
            ? { ok: true }
            : service.respond(method, parsed.pathname, {
                body: await jsonBody(request),
                query: parsed.searchParams,
              })
          : respondTo(method, url);
        const status =
          answer instanceof StandInStatus
            ? answer.status
            : answer === undefined
              ? 404
              : 200;
        const body = answer instanceof StandInStatus ? answer.body : answer;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body ?? { error: "not found" }));
      })();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error(`${fixture.slug}: the fixture server has no port`);
    }

    await writeApp(
      appsDir,
      fixture,
      {
        auth: { kind: "none" },
        test: { path: "/health" },
        type: "api",
        url: `http://127.0.0.1:${address.port}`,
      },
      [
        service?.about ?? `${fixture.name} tracks the team's issues.`,
        "",
        "## Endpoints",
        "",
        ...(service?.endpoints ?? [
          "- `GET /issues` -- every issue, as `{ issues: [{ id, title, state }] }`.",
          "- `GET /issues/<id>` -- one issue.",
          '- `POST /issues` -- file one, as `{ "title": "...", "body": "..." }`.',
        ]),
        "",
      ].join("\n"),
    );

    await recordConnected(fixture.slug, { apps, appsDir });
  }

  return {
    close: async () => {
      await Promise.all([
        ...closers.map((close) => close()),
        ...servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => {
                resolve();
              });
            }),
        ),
      ]);
    },
  };
}

/**
 * Writes the app's folder the way the product writes one, so a case runs
 * against a real `APP.md` in a folder named for the app rather than a layout
 * of the fixture's own.
 */
async function writeApp(
  appsDir: string,
  fixture: AppFixture,
  manifest: unknown,
  guide: string,
): Promise<void> {
  await writeAppFolder({
    appsDir: AbsolutePathSchema.parse(appsDir),
    guide,
    manifest: AppManifestSchema.parse(manifest),
    name: fixture.name,
    slug: AppSlugSchema.parse(fixture.slug),
  });
}

/**
 * Puts the app's connection on record. Through the loader, so the hash the
 * connection records is the one the connection check will compute.
 */
async function recordConnected(
  slug: string,
  { apps, appsDir }: { apps: WorkspaceAppsConfig; appsDir: string },
) {
  const loaded = await loadApp(AbsolutePathSchema.parse(appsDir), slug);
  if (loaded.isErr()) {
    throw new Error(`${slug}: ${loaded.error.message}`);
  }
  await apps.connections.set(slug, {
    connectedAt: Date.now(),
    manifestHash: loaded.value.manifestHash,
    status: "connected",
    updatedAt: Date.now(),
  });
}

const ISSUES = [
  { id: "ENG-118", state: "in progress", title: "Sign-in loops on Windows" },
  {
    id: "ENG-204",
    state: "todo",
    title: "Folder picker forgets its last path",
  },
  { id: "ENG-231", state: "done", title: "Crash when a task is renamed twice" },
];

function respondTo(method: string, url: string): unknown {
  const pathname = url.split("?")[0] ?? "/";
  if (pathname === "/health") {
    return { ok: true };
  }
  if (pathname === "/issues") {
    // Filed issues are acknowledged rather than kept: what a case scores is who
    // made the call, and a growing list would make one run's result depend on
    // the last one's.
    return method === "POST"
      ? { filed: true, id: `ENG-${300 + ISSUES.length}` }
      : { issues: ISSUES };
  }
  const match = /^\/issues\/([\w-]+)$/.exec(pathname);
  const issue = match
    ? ISSUES.find((candidate) => candidate.id === match[1])
    : undefined;
  return issue;
}
