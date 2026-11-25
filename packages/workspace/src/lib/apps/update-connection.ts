import { type AppCatalogEntry, catalogEntryForApp } from "./catalog";
import { appChanged } from "./changed";
import {
  readConnection,
  recordConnection,
  type SignInOpensIn,
} from "./connection";
import {
  type ApiAppManifest,
  type AppManifest,
  AppManifestSchema,
  type McpAppManifest,
} from "./manifest";
import {
  type AppInfo,
  guidePlaceholdersLeft,
  guideSkeleton,
  loadApp,
  writeApp,
} from "./store";
import { catalogWayIn } from "./way-in";

/**
 * Moving an app worked on its service's site to the sign-in the directory has
 * for the service, which the person asks for with Update on the app's page. A
 * directory that gains a direct sign-in leaves the apps already set up as they
 * are. The app stays on the web, connected, until the new sign-in has been
 * checked: nothing about an update that is stopped, refused or left open is
 * written to its connection.
 */

/** An app's setup once updated: one that signs in directly. */
export type UpdatedManifest = ApiAppManifest | McpAppManifest;

/** How an update that did not go through ended. */
export type AppUpdateEnd = "declined" | "expired" | "failed" | "refused";

export interface EndedAppUpdate {
  at: number;
  ended: AppUpdateEnd;
  error?: string;
}

// Kept for this run only, so a service whose rule changes is offered again.
const endings = new Map<string, EndedAppUpdate>();

/** Whether the directory reaches an entry through a sign-in alone, no key. */
export function entrySignsInDirectly(entry: AppCatalogEntry): boolean {
  return directReach(entry) !== undefined;
}

function directReach(
  entry: AppCatalogEntry,
): Record<string, unknown> | undefined {
  const way = catalogWayIn(entry);
  if (way.kind === "mcp" && way.auth === undefined) {
    return { auth: { kind: "oauth" }, type: "mcp", url: way.endpoint };
  }
  if (way.kind === "api" && way.auth === "oauth" && way.test !== undefined) {
    return {
      auth: { kind: "oauth" },
      test: { path: way.test },
      type: "api",
      url: way.endpoint,
    };
  }
  return undefined;
}

function isUpdated(manifest: AppManifest): manifest is UpdatedManifest {
  return manifest.type === "api" || manifest.type === "mcp";
}

/**
 * What an app on the web becomes when it is updated: the setup and guide the
 * directory has for its service. Undefined where the directory has no direct
 * sign-in, and for an app that was put on the web when it had one.
 */
export function appUpdate(
  app: Pick<AppInfo, "manifest" | "slug">,
): undefined | { guide: string; manifest: UpdatedManifest } {
  const { manifest, slug } = app;
  if (manifest.type !== "web" || manifest.webChosen) {
    return undefined;
  }
  const entry = catalogEntryForApp(slug, manifest);
  const reach = entry && directReach(entry);
  if (!reach) {
    return undefined;
  }
  const updated = AppManifestSchema.parse({
    ...reach,
    ...(manifest.account === undefined ? {} : { account: manifest.account }),
    service: entry.slug,
  });
  const guide = guideSkeleton(updated, entry, slug);
  return isUpdated(updated) &&
    guidePlaceholdersLeft(updated, guide).length === 0
    ? { guide, manifest: updated }
    : undefined;
}

/** How the app's last update ended, where it did not go through. */
export function endedAppUpdate(slug: string): EndedAppUpdate | undefined {
  return endings.get(slug);
}

/** A new try is under way, so how the last one ended is no longer news. */
export function forgetEndedAppUpdate(slug: string): void {
  endings.delete(slug);
}

/** An update that did not go through: the app's page says so, and the app is as it was. */
export async function appUpdateEnded(
  slug: string,
  ended: AppUpdateEnd,
  error?: string,
): Promise<void> {
  endings.set(slug, {
    at: Date.now(),
    ended,
    ...(error === undefined ? {} : { error }),
  });
  await appChanged(slug);
}

/**
 * Writes the app as updated and connected, once its new sign-in has been
 * checked against `manifest`. False, writing nothing, where the app is not
 * on the web any more.
 */
export async function finishAppUpdate({
  manifest,
  opensIn,
  slug,
  toolCount,
}: {
  manifest: UpdatedManifest;
  opensIn: SignInOpensIn;
  slug: string;
  toolCount?: number;
}): Promise<boolean> {
  const loaded = await loadApp(slug);
  if (loaded.isErr()) {
    return false;
  }
  const app = loaded.value;
  const update = appUpdate(app);
  const connection = await readConnection(slug);
  // The sign-in is for the address it began against, and an app taken off
  // the web or disconnected meanwhile is no longer the one being updated.
  if (
    update === undefined ||
    update.manifest.url !== manifest.url ||
    connection?.status !== "connected"
  ) {
    return false;
  }
  await writeApp({
    guide: update.guide,
    manifest: update.manifest,
    name: app.name,
    replacesGuide: true,
    slug: app.slug,
  });
  const written = await loadApp(slug);
  if (written.isErr()) {
    return false;
  }
  await recordConnection(slug, {
    connectedAt: Date.now(),
    error: undefined,
    manifestHash: written.value.manifestHash,
    signedInFrom: opensIn,
    status: "connected",
    ...(toolCount === undefined ? {} : { toolCount }),
  });
  endings.delete(slug);
  return true;
}
