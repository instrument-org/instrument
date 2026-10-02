import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { loadApp } from "../../src/lib/apps/store";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type WorkspaceAppsConfig } from "../../src/types";

/** A connected app a case wants to exist before it runs. */
export interface AppFixture {
  /** What the user calls it, as the manifest carries it. */
  name: string;
  slug: string;
}

/**
 * Stands up the apps a case declared: a real HTTP server on loopback, a real
 * manifest in the workspace's apps directory, and a connection on record, so
 * `app request` goes end to end and `task app --add` has something it can
 * actually hand over.
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
  for (const fixture of fixtures) {
    const server = http.createServer((request, response) => {
      const body = respondTo(request.method ?? "GET", request.url ?? "/");
      response.writeHead(body === undefined ? 404 : 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(body ?? { error: "not found" }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error(`${fixture.slug}: the fixture server has no port`);
    }

    const dir = path.join(appsDir, fixture.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "app.json"),
      `${JSON.stringify(
        {
          auth: { kind: "none" },
          baseUrl: `http://127.0.0.1:${address.port}`,
          name: fixture.name,
          test: { path: "/health" },
          type: "api",
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(dir, "guide.md"),
      [
        `# ${fixture.name}`,
        "",
        `${fixture.name} tracks the team's issues.`,
        "",
        "## Endpoints",
        "",
        "- `GET /issues` -- every issue, as `{ issues: [{ id, title, state }] }`.",
        "- `GET /issues/<id>` -- one issue.",
        '- `POST /issues` -- file one, as `{ "title": "...", "body": "..." }`.',
        "",
      ].join("\n"),
    );

    // Through the loader, so the hash the connection records is the one the
    // connection check will compute.
    const loaded = await loadApp(
      AbsolutePathSchema.parse(appsDir),
      fixture.slug,
    );
    if (loaded.isErr()) {
      throw new Error(`${fixture.slug}: ${loaded.error.message}`);
    }
    await apps.connections.set(fixture.slug, {
      manifestHash: loaded.value.manifestHash,
      status: "connected",
      updatedAt: Date.now(),
    });
  }

  return {
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => {
                resolve();
              });
            }),
        ),
      );
    },
  };
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
