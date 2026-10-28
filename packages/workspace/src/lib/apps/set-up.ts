import { getWorkspaceConfig } from "../workspace-config";
import {
  catalogEntryForApp,
  getAppCatalog,
  serviceManifestFields,
} from "./catalog";
import { appChanged } from "./changed";
import { recordConnection } from "./connection";
import { AppManifestSchema, type AppSlug, AppSlugSchema } from "./manifest";
import {
  guidePlaceholdersLeft,
  guideSkeleton,
  listApps,
  loadApp,
  writeAppFolder,
} from "./store";
import { runAppTest } from "./test-app";
import { bundledMacAppHere } from "./mac-app";
import { catalogWayIn, parseAuth } from "./way-in";
import { webInsteadUrl } from "./site";

const OPEN_TEST_TIMEOUT_MS = 30_000;

/**
 * Sets a service the directory lists up as an app, from the way in the
 * directory has for it, with no agent: what the agent would otherwise copy
 * out of `instrument app catalog` and could get wrong. Writes the folder and leaves
 * the app waiting on the one thing only the user gives (a sign-in, a key,
 * the go-ahead to run a server, signing in on the site); a server that
 * wants none of those is tested and connected on the spot.
 *
 * A service already set up gets one more app beside the first, under the
 * next free slug (gmail, then gmail-2), for a second account; nothing that
 * is already there is written over. One of the Mac's own apps is set up on
 * the server the app ships for it, under the Mac app's own name, and waits
 * on the person's go-ahead like any server that runs here; on a computer
 * that can't run it, as for a way in the directory cannot finish alone (an
 * API whose guide still has to be written), the answer is `agent`, which the
 * caller hands to the agent.
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
  const macApp =
    way.kind === "mac-app" && entry.family === "apple"
      ? bundledMacAppHere(way.bundleId)
      : undefined;
  const name = macApp?.name ?? entry.name;
  const { appsDir } = getWorkspaceConfig();
  const { apps: present, invalid } = await listApps(appsDir);
  // A Mac app has one of itself, which covers every account added to it.
  const already = macApp
    ? present.find(
        (app) =>
          app.manifest.type === "mcp-local" &&
          app.manifest.runtime === "bundled" &&
          app.manifest.package === macApp.server,
      )
    : undefined;
  if (already) {
    return { kind: "set-up", slug: already.slug };
  }
  const fields = serviceManifestFields(entry, {
    anotherAccount: present.some(
      (app) => catalogEntryForApp(app.slug, app.manifest)?.slug === entry.slug,
    ),
    web: way.kind === "web",
  });
  const candidate: unknown =
    way.kind === "mcp"
      ? {
          auth: parseAuth(way.auth, "mcp"),
          ...fields,
          type: "mcp",
          url: way.endpoint,
        }
      : way.kind === "local"
        ? {
            auth: { kind: "none" },
            package: way.package,
            runtime: way.runtime,
            ...fields,
            type: "mcp-local",
          }
        : way.kind === "api" && way.test !== undefined
          ? {
              auth: parseAuth(way.auth, "api"),
              ...fields,
              test: { path: way.test },
              type: "api",
              url: way.endpoint,
            }
          : way.kind === "web"
            ? {
                ...fields,
                type: "web",
                url: way.url,
              }
            : macApp
              ? {
                  auth: { kind: "none" },
                  macApp: macApp.bundleId,
                  package: macApp.server,
                  runtime: "bundled",
                  ...fields,
                  type: "mcp-local",
                }
              : undefined;
  if (candidate === undefined) {
    return { kind: "agent" };
  }
  const manifest = AppManifestSchema.parse(candidate);
  // A broken file keeps its id, so the next app of the service passes it by.
  const taken = new Set([
    ...present.map((app) => String(app.slug)),
    ...invalid.map((app) => app.slug),
  ]);
  const slug = AppSlugSchema.parse(nextFreeSlug(entry.slug, taken));
  const guide = guideSkeleton(manifest, entry, slug);
  if (guidePlaceholdersLeft(manifest, guide).length > 0) {
    return { kind: "agent" };
  }
  await writeAppFolder({ appsDir, guide, manifest, name, slug });

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

/**
 * Moves an app set up another way over to signing in on the web: the same
 * app, its name and folder kept, now a web app at the service's site, whose
 * sign-in starts where the directory says. What `instrument app new <slug>
 * --web <url> --force` writes, for the card's "Sign in on the web" after its
 * own sign-in failed. The chats still waiting on the app stay waiting, and
 * hear of it once the user says they are signed in. Answers the page the
 * sign-in opens; an app that is already a web app is left as it is.
 */
export async function moveAppToWeb(
  slug: string,
): Promise<{ name: string; signIn: string }> {
  const { appsDir } = getWorkspaceConfig();
  const loaded = await loadApp(appsDir, slug);
  if (loaded.isErr()) {
    throw new Error(loaded.error.message);
  }
  const { manifest, name } = loaded.value;
  if (manifest.type === "web") {
    return { name, signIn: manifest.signIn ?? manifest.url };
  }
  const url = webInsteadUrl(slug, manifest);
  if (url === undefined) {
    throw new Error(`${name} has no site to sign in on.`);
  }
  const entry = catalogEntryForApp(slug, manifest);
  const { apps: present } = await listApps(appsDir);
  const fields =
    entry === undefined
      ? {}
      : serviceManifestFields(entry, {
          anotherAccount: present.some(
            (app) =>
              app.slug !== slug &&
              catalogEntryForApp(app.slug, app.manifest)?.slug === entry.slug,
          ),
          web: true,
        });
  const web = AppManifestSchema.parse({ ...fields, type: "web", url });
  await writeAppFolder({
    appsDir,
    guide: guideSkeleton(web, entry),
    manifest: web,
    name,
    replacesGuide: true,
    slug: AppSlugSchema.parse(slug),
  });
  await recordConnection(slug, { status: "needs-sign-in" });
  return { name, signIn: web.type === "web" ? (web.signIn ?? web.url) : url };
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
