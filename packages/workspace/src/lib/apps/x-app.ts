import { appChanged } from "./changed";
import { AppSlugSchema, type WebAppManifest } from "./manifest";
import { guideSkeleton, listApps, loadApp, writeApp } from "./store";
import { isXApp } from "./x-site";

/** The X app a Grok plan sign-in sets up where the workspace has none. */
const X_APP = {
  manifest: { type: "web", url: "https://x.com" } satisfies WebAppManifest,
  name: "X",
  slug: "x",
} as const;

/**
 * A Grok plan signed in on this computer: X's search works from now on, so
 * a workspace with no app on X's site gets one, and every X app already
 * here is told the plan is in, which answers a card waiting on it. Answers
 * the id of the app it set up, if it set one up.
 */
export async function grokPlanSignedInHere(): Promise<string | undefined> {
  if ((await tellXAppsThePlanIsIn()) > 0) {
    return undefined;
  }
  const slug = await unusedSlug(X_APP.slug);
  await writeApp({
    guide: guideSkeleton(X_APP.manifest, undefined, slug),
    manifest: X_APP.manifest,
    name: X_APP.name,
    slug,
  });
  await appChanged(slug);
  return slug;
}

/**
 * A Grok account switched on in Settings, which X's search can run on
 * again: every X app here is told the plan is in, which answers a card
 * waiting on it. Sets up no app, since switching an account on is no
 * sign-in.
 */
export async function grokPlanSwitchedOnHere(): Promise<void> {
  await tellXAppsThePlanIsIn();
}

/** Tells every X app here the Grok plan is in; answers how many there are. */
async function tellXAppsThePlanIsIn(): Promise<number> {
  const { apps } = await listApps();
  const xApps = apps.filter((app) => isXApp(app.manifest));
  for (const app of xApps) {
    await appChanged(app.slug, { event: "connected", plan: "grok" });
  }
  return xApps.length;
}

/** `wanted`, or the first of `wanted-2`, `wanted-3`... nothing in the store is. */
async function unusedSlug(wanted: string) {
  for (let count = 1; ; count++) {
    const slug = AppSlugSchema.parse(
      count === 1 ? wanted : `${wanted}-${String(count)}`,
    );
    const loaded = await loadApp(slug);
    if (loaded.isErr() && loaded.error.reason === "not-found") {
      return slug;
    }
  }
}
