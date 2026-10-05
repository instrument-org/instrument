import { getWorkspaceConfig } from "../workspace-config";
import { getAppCatalog } from "./catalog";
import { appChanged } from "./changed";
import { recordConnection } from "./connection";
import { AppManifestSchema, type AppSlug, AppSlugSchema } from "./manifest";
import {
  guidePlaceholdersLeft,
  guideSkeleton,
  listApps,
  writeAppFolder,
} from "./store";
import { runAppTest } from "./test-app";
import { catalogWayIn, parseAuth } from "./way-in";

const OPEN_TEST_TIMEOUT_MS = 30_000;

/**
 * Sets a service the directory lists up as an app, from the way in the
 * directory has for it, with no agent: what the agent would otherwise copy
 * out of `app catalog` and could get wrong. Writes the folder and leaves
 * the app waiting on the one thing only the user gives (a sign-in, a key,
 * the go-ahead to run a server, signing in on the site); a server that
 * wants none of those is tested and connected on the spot.
 *
 * A service already set up gets one more app beside the first, under the
 * next free slug (gmail, then gmail-2), for a second account; nothing that
 * is already there is written over. Answers `agent` for a way in the
 * directory cannot finish alone (a Mac app a task drives, an API whose
 * guide still has to be written), which the caller hands to the agent.
 */
export async function setUpFromDirectory({
  signal,
  slug: entrySlug,
}: {
  signal?: AbortSignal;
  slug: string;
}): Promise<{ kind: "agent" } | { kind: "set-up"; slug: AppSlug }> {
  const entry = getAppCatalog().find(
    (candidate) => candidate.slug === entrySlug,
  );
  if (entry === undefined) {
    return { kind: "agent" };
  }
  const way = catalogWayIn(entry);
  const name = entry.name;
  const candidate: unknown =
    way.kind === "mcp"
      ? {
          auth: parseAuth(way.auth, "mcp"),
          name,
          type: "mcp",
          url: way.endpoint,
        }
      : way.kind === "local"
        ? {
            auth: { kind: "none" },
            name,
            package: way.package,
            runtime: way.runtime,
            type: "mcp-local",
          }
        : way.kind === "api" && way.test !== undefined
          ? {
              auth: parseAuth(way.auth, "api"),
              baseUrl: way.endpoint,
              name,
              test: { path: way.test },
              type: "api",
            }
          : way.kind === "web"
            ? {
                name,
                ...(way.signIn ? { signIn: way.signIn } : {}),
                type: "web",
                url: way.url,
              }
            : undefined;
  if (candidate === undefined) {
    return { kind: "agent" };
  }
  const manifest = AppManifestSchema.parse(candidate);
  const guide = guideSkeleton(manifest, entry);
  if (guidePlaceholdersLeft(manifest, guide).length > 0) {
    return { kind: "agent" };
  }

  const { appsDir } = getWorkspaceConfig();
  const taken = new Set(
    (await listApps(appsDir)).apps.map((app) => String(app.slug)),
  );
  const slug = AppSlugSchema.parse(nextFreeSlug(entry.slug, taken));
  await writeAppFolder({ appsDir, guide, manifest, slug });

  if (manifest.type === "mcp" && manifest.auth.kind === "none") {
    // Nothing for the user to give: the test is the whole of connecting.
    await runAppTest({
      appsDir,
      signal: AbortSignal.any([
        AbortSignal.timeout(OPEN_TEST_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
      slug,
    });
  } else {
    await recordConnection(slug, {
      status:
        manifest.type === "mcp-local"
          ? "needs-approval"
          : manifest.type === "web" || manifest.auth.kind === "oauth"
            ? "needs-sign-in"
            : "needs-key",
    });
  }
  await appChanged(slug);
  return { kind: "set-up", slug };
}

/** The slug for one more app of a service: its own, then -2, -3, and on. */
function nextFreeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const slug = `${base}-${n}`;
    if (!taken.has(slug)) {
      return slug;
    }
  }
}
