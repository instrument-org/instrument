import { APP_NAME } from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import { createHash } from "node:crypto";
import { omit } from "radashi";
import { z } from "zod";

import { type DeviceId, DeviceIdSchema } from "../records/device-id";
import { heldStore, type WorkspacePlace } from "../synced-store/held-stores";
import { type SyncedStore } from "../synced-store/synced-store";
import { type SyncedOp } from "../synced-store/synced-record";
import { macAppNamed } from "../mac-apps/apps";
import { APP_COMMAND } from "../../model-text/commands/app-command";
import { macAppGuide } from "../../model-text/guides/mac-app-guide";
import {
  type AppFile,
  appFileOf,
  isOwnSetupKey,
  unusedAppName,
} from "./app-file";
import { type AppCatalogEntry, catalogEntryForApp } from "./catalog";
import {
  type AppManifest,
  AppManifestSchema,
  manifestHash,
  type AppSlug,
  AppSlugSchema,
} from "./manifest";

/**
 * The workspace's apps: the `apps` synced store (`docs/architecture/synced-stores.md`),
 * each device appending to its own `.instrument/devices/<device>/apps.jsonl`.
 * An app is one key, `app/<slug>`, whose value is its name, its setup (the
 * manifest, with every key this build does not read kept beside it) and its
 * guide; its own icon, when it has one, is a key of its own, `icon/<slug>`,
 * so a change to the guide never writes the icon's bytes again.
 *
 * The slug is the app's identity, since the credential store and the
 * connection record are keyed by it. Nothing writes an app but the
 * `instrument app` command, the Apps page and the launch that takes in the
 * folders earlier builds kept.
 */

/** The store's file name, before `.jsonl`. */
const APPS_DOMAIN = "apps";

const APP_PREFIX = "app/";
const ICON_PREFIX = "icon/";
const SIGN_IN_PREFIX = "sign-in/";

/**
 * An app's value in the store. Loose, so a field a newer build adds goes
 * back out as it came in when this build rewrites the app.
 */
const AppValueSchema = z.looseObject({
  guide: z.string().default(""),
  name: z.string().min(1),
  /** What `APP.md`'s front matter held but its `id`: the manifest, and any key this build does not read. */
  setup: z.record(z.string(), z.unknown()).default({}),
});

type AppValue = z.output<typeof AppValueSchema>;

const AppIconValueSchema = z.object({
  /** The icon's bytes, base64. */
  data: z.string().min(1),
  fileName: z.enum(["icon.svg", "icon.png"]),
});

export type AppIconValue = z.output<typeof AppIconValueSchema>;

export interface AppInfo {
  manifest: AppManifest;
  /** What the connection record is pinned to: the manifest as the store has it. */
  manifestHash: string;
  /** What the person calls it. */
  name: string;
  slug: AppSlug;
}

interface AppLoadError {
  message: string;
  reason: "invalid-manifest" | "invalid-slug" | "not-found";
}

/** The apps store of the workspace this process runs, or of the one `place` names. */
export function appsStore(place?: WorkspacePlace): Promise<SyncedStore> {
  return heldStore(APPS_DOMAIN, place);
}

/**
 * Makes the changes `make` answers for the store as it is, after every write
 * asked for before it has landed.
 */
async function writeApps<T>(
  make: (store: SyncedStore) => { ops: SyncedOp[]; result: T },
): Promise<T> {
  const store = await appsStore();
  return store.exclusive(async () => {
    await store.caughtUp();
    const { ops, result } = make(store);
    await store.apply(ops);
    return result;
  });
}

/** Makes changes that do not depend on what the store has. */
async function setKeys(ops: SyncedOp[]): Promise<void> {
  const store = await appsStore();
  await store.exclusive(() => store.apply(ops));
}

function appValueOf(value: unknown): AppValue | undefined {
  const parsed = AppValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** An app's key in the store. */
export function appKey(slug: AppSlug): string {
  return `${APP_PREFIX}${slug}`;
}

/** An app's icon's key in the store. */
export function appIconKey(slug: AppSlug): string {
  return `${ICON_PREFIX}${slug}`;
}

/** What the store holds for an app, read the way an `APP.md` was. */
function readValue(slug: string, value: AppValue) {
  return appFileOf(
    { ...value.setup, id: slug },
    { guide: value.guide, what: `${slug}'s setup` },
  );
}

/**
 * The value an app is written as: its name, its setup with every key found
 * with it kept, and its guide.
 */
function appValue({
  app,
  kept,
  name,
}: {
  app: AppFile;
  /** The value it replaces, whose fields this build does not write are kept. */
  kept?: AppValue;
  name: string;
}): AppValue {
  return {
    ...kept,
    guide: app.guide.trim(),
    name,
    setup: { ...app.others, ...app.manifest },
  };
}

/**
 * Every app in the store, by name. One whose setup this build cannot read is
 * returned separately, so callers (the Apps screen, `instrument app list`)
 * can say so instead of letting the app disappear.
 */
export async function listApps(): Promise<{
  apps: AppInfo[];
  invalid: { message: string; slug: string }[];
}> {
  const store = await appsStore();
  const apps: AppInfo[] = [];
  const invalid: { message: string; slug: string }[] = [];
  for (const [key, raw] of store.entries(APP_PREFIX)) {
    const slug = key.slice(APP_PREFIX.length);
    const value = appValueOf(raw);
    if (!value) {
      invalid.push({ message: `"${slug}" has no name.`, slug });
      continue;
    }
    const read = readValue(slug, value);
    if (read.kind === "app") {
      apps.push(appInfoOf(value.name, read.app));
    } else if (read.kind === "invalid") {
      invalid.push({ message: read.message, slug });
    }
  }
  return {
    apps: apps.toSorted(
      (a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug),
    ),
    invalid: invalid.toSorted((a, b) => a.slug.localeCompare(b.slug)),
  };
}

/** One app by its id. */
export async function loadApp(
  rawSlug: string,
): Promise<Result<AppInfo, AppLoadError>> {
  const slugResult = AppSlugSchema.safeParse(rawSlug);
  if (!slugResult.success) {
    return err({
      message: `"${rawSlug}" is not an app id (lowercase letters, digits, and hyphens).`,
      reason: "invalid-slug",
    });
  }
  const slug = slugResult.data;
  const value = appValueOf((await appsStore()).get(appKey(slug)));
  if (!value) {
    return err({
      message: `No app is "${slug}". \`${APP_COMMAND.name} list\` lists the apps set up here.`,
      reason: "not-found",
    });
  }
  const read = readValue(slug, value);
  return read.kind === "app"
    ? ok(appInfoOf(value.name, read.app))
    : err({
        message:
          read.kind === "invalid" ? read.message : `"${slug}" is not an app.`,
        reason: "invalid-manifest",
      });
}

/** The app's guide, or nothing where it has none. */
export async function readAppGuide(slug: AppSlug): Promise<null | string> {
  const value = appValueOf((await appsStore()).get(appKey(slug)));
  const guide = value?.guide.trim() ?? "";
  return guide === "" ? null : `${guide}\n`;
}

/**
 * The app's setup as the store has it: the manifest and every key kept with
 * it, whether or not this build can read them as a manifest.
 */
export async function readAppSetup(
  slug: AppSlug,
): Promise<Record<string, unknown> | undefined> {
  return appValueOf((await appsStore()).get(appKey(slug)))?.setup;
}

/** Writes the app's guide, keeping everything else about it. */
export async function writeAppGuide(slug: AppSlug, guide: string) {
  await writeApps((store) => {
    const value = appValueOf(store.get(appKey(slug)));
    if (!value) {
      throw new Error(`No app is "${slug}", so there is no guide to write.`);
    }
    return {
      ops: [
        {
          key: appKey(slug),
          t: "set",
          value: { ...value, guide: guide.trim() },
        },
      ],
      result: undefined,
    };
  });
}

/**
 * Writes the app's setup whole, keeping its name and guide: what `setup`
 * holds becomes the manifest, with any key the manifest does not have kept
 * beside it. Throws, writing nothing, for a setup that is not a manifest.
 */
export async function writeAppSetup(
  slug: AppSlug,
  setup: Record<string, unknown>,
): Promise<AppManifest> {
  return writeApps((store) => {
    const value = appValueOf(store.get(appKey(slug)));
    if (!value) {
      throw new Error(`No app is "${slug}", so there is no setup to write.`);
    }
    const read = appFileOf(
      { ...omit(setup, ["id"]), id: slug },
      { guide: value.guide, what: "The setup" },
    );
    if (read.kind !== "app") {
      throw new Error(
        read.kind === "invalid" ? read.message : "the setup names no app.",
      );
    }
    return {
      ops: [
        {
          key: appKey(slug),
          t: "set",
          value: appValue({ app: read.app, kept: value, name: value.name }),
        },
      ],
      result: read.app.manifest,
    };
  });
}

/**
 * The prompts `guideSkeleton` leaves for the agent to answer, in one place so
 * the skeleton that writes them and the check that looks for them cannot drift
 * apart.
 */
const GUIDE_PROMPTS = {
  conventions:
    "Anything a request has to get right that the service does not say in its errors.",
  endpoints:
    "List the endpoints the work needs, with an example each: the method, the path relative to the base URL, the parameters, and what comes back. Pagination and rate limits go here too.",
  purpose: "What this app is for, in a sentence or two.",
} as const;

/**
 * Which of the skeleton's prompts an app still has to answer before it
 * connects.
 *
 * Only an API app's guide is read: it is what the first request in a task is
 * handed instead of its answer, so a folder that connects with the skeleton in
 * place spends that turn showing the agent the form it was asked to fill in.
 * An MCP app's tools describe themselves and nothing hands its guide to a
 * task, so it never waits on one.
 */
export function guidePlaceholdersLeft(
  manifest: AppManifest,
  guide: string,
): string[] {
  if (manifest.type !== "api") {
    return [];
  }
  return Object.values(GUIDE_PROMPTS).filter((prompt) =>
    guide.includes(prompt),
  );
}

/**
 * An app's first guide: what the directory says the service is for, and how
 * it is reached. An MCP app's is complete as written. An API app's carries
 * the directory's endpoints and conventions when it has them, and otherwise
 * the prompts the agent answers before connecting.
 *
 * It opens with no heading: the app's name is shown above it.
 */
export function guideSkeleton(
  manifest: AppManifest,
  entry?: AppCatalogEntry,
  slug = "<slug>",
): string {
  const tools = `\`${APP_COMMAND.name} tools <slug>\` lists what it can do, \`${APP_COMMAND.name} call <slug> <tool> '<json>'\` runs one.`;
  const macApp =
    manifest.type === "mcp-local" && manifest.runtime === "bundled"
      ? macAppNamed(manifest.package)
      : undefined;
  if (macApp) {
    return `${macAppGuide(macApp, slug)}\n`;
  }
  if (manifest.type !== "api") {
    const reach =
      manifest.type === "mcp-local"
        ? `Runs on this machine from the ${manifest.runtime === "node" ? "npm" : "PyPI"} package ${manifest.package}: ${tools}`
        : manifest.type === "web"
          ? `Worked on the web at ${manifest.url}, where the user signs in in ${APP_NAME}'s browser: a task opens the site in a tab and works there. No \`${APP_COMMAND.name}\` call or request reaches it.`
          : `Reached through its MCP server at ${manifest.url}: ${tools}`;
    return `${entry ? `${entry.description}\n\n` : ""}${reach}\n`;
  }
  const guide = entry?.apiGuide;
  return `${entry?.description ?? GUIDE_PROMPTS.purpose}\n\nReached through its API at ${manifest.url}: \`${APP_COMMAND.name} request <slug> GET /path\`.\n\n## Endpoints\n\n${guide?.endpoints ?? GUIDE_PROMPTS.endpoints}\n\n## Conventions\n\n${guide?.conventions ?? GUIDE_PROMPTS.conventions}\n`;
}

/**
 * Names the account an app is signed in as, or clears the name, rewriting
 * its manifest and keeping its guide. The name is outside the manifest's
 * hash. Where the directory has an address for one account of the service
 * (`accountHome`), naming a web app's account also moves the app there, so
 * its tasks open that account rather than whichever the site shows first;
 * that changes the hash, so `nameAppAccount` carries the connection over.
 * Clearing the name leaves the address where it is.
 */
export async function setAppAccount(
  slug: AppSlug,
  account: string | undefined,
): Promise<AppManifest> {
  const current = (await requireApp(slug)).manifest;
  const rest = omit(current, ["account"]);
  if (account === undefined) {
    return writeManifest(slug, AppManifestSchema.parse(rest));
  }
  const accountHome =
    current.type === "web"
      ? catalogEntryForApp(slug, current)?.accountHome
      : undefined;
  return writeManifest(
    slug,
    AppManifestSchema.parse({
      ...rest,
      account,
      ...(accountHome
        ? { url: accountHome.replace("{account}", encodeURIComponent(account)) }
        : {}),
    }),
  );
}

/**
 * Writes an app: its manifest over the setup it had, keeping the keys this
 * build does not read. An app already here keeps its name, whatever the
 * person has renamed it to, and keeps its guide unless `replacesGuide` says
 * the service is reached another way now. A new one takes `name`, numbered
 * where another app has that name, which is what a second account of one
 * service comes to. Answers the name the app has.
 */
export async function writeApp({
  guide,
  manifest,
  name,
  replacesGuide = false,
  slug,
}: {
  guide: string;
  manifest: AppManifest;
  /** What the app is called when it is new. */
  name: string;
  /** Writes the guide over one already there, for a manifest that reaches the service another way. */
  replacesGuide?: boolean;
  slug: AppSlug;
}): Promise<string> {
  return writeApps((store) => {
    const here = appValueOf(store.get(appKey(slug)));
    // Keys of the old setup this build reads are the new manifest's to say,
    // so one it leaves out goes; the rest stay as they were.
    const kept = Object.fromEntries(
      Object.entries(here?.setup ?? {}).filter(([key]) => !isOwnSetupKey(key)),
    );
    const taken = [...store.entries(APP_PREFIX)].flatMap(([key, value]) =>
      key === appKey(slug) ? [] : [appValueOf(value)?.name ?? ""],
    );
    const named = here?.name ?? unusedAppName(name, taken);
    const keptGuide = here === undefined || replacesGuide ? "" : here.guide;
    return {
      ops: [
        {
          key: appKey(slug),
          t: "set",
          value: appValue({
            app: {
              guide: keptGuide || guide,
              id: slug,
              manifest,
              ...(Object.keys(kept).length > 0 ? { others: kept } : {}),
            },
            ...(here ? { kept: here } : {}),
            name: named,
          }),
        },
      ],
      result: named,
    };
  });
}

/** Takes the app and its icon out of the store. */
export async function removeApp(slug: AppSlug): Promise<void> {
  await setKeys([
    { key: appKey(slug), t: "del" },
    { key: appIconKey(slug), t: "del" },
  ]);
}

/**
 * Where an app stands on one computer, as that computer last wrote it, for
 * the others to read: a key per computer and app, `sign-in/<device>/<slug>`,
 * so each computer's word stands beside the others' rather than the newest
 * replacing them. Never a secret: the status, the account, and the manifest
 * it holds for. The credential and the record a call goes through on stay
 * on the computer (`connection.ts`).
 */
const PublishedSignInSchema = z.looseObject({
  account: z.string().optional(),
  manifestHash: z.string().optional(),
  status: z.string(),
  updatedAt: z.number(),
});

export type PublishedSignIn = z.output<typeof PublishedSignInSchema>;

function signInKey(device: DeviceId, slug: string): string {
  return `${SIGN_IN_PREFIX}${device}/${slug}`;
}

/**
 * Writes where an app stands on this computer, for the others to read; a
 * standing the store already has is left alone, so a launch that writes
 * every app's writes only what changed.
 */
export async function publishSignIn(
  device: DeviceId,
  slug: string,
  standing: PublishedSignIn,
): Promise<void> {
  const key = signInKey(device, slug);
  const store = await appsStore();
  await store.exclusive(async () => {
    const current = PublishedSignInSchema.safeParse(store.get(key));
    if (
      current.success &&
      current.data.status === standing.status &&
      current.data.account === standing.account &&
      current.data.manifestHash === standing.manifestHash
    ) {
      return;
    }
    await store.apply([{ key, t: "set", value: standing }]);
  });
}

/** Where each app stands on every computer but this one, by slug. */
export async function signInsElsewhere(
  device: DeviceId,
): Promise<Map<string, (PublishedSignIn & { device: DeviceId })[]>> {
  const bySlug = new Map<string, (PublishedSignIn & { device: DeviceId })[]>();
  for (const [key, raw] of (await appsStore()).entries(SIGN_IN_PREFIX)) {
    const [other, slug] = key.slice(SIGN_IN_PREFIX.length).split("/");
    const parsed = PublishedSignInSchema.safeParse(raw);
    const known = DeviceIdSchema.safeParse(other);
    if (
      slug === undefined ||
      !parsed.success ||
      !known.success ||
      known.data === device
    ) {
      continue;
    }
    bySlug.set(slug, [
      ...(bySlug.get(slug) ?? []),
      { ...parsed.data, device: known.data },
    ]);
  }
  return bySlug;
}

/** The app's own icon, when it has one. */
export async function readAppIcon(
  slug: AppSlug,
): Promise<AppIconValue | undefined> {
  const parsed = AppIconValueSchema.safeParse(
    (await appsStore()).get(appIconKey(slug)),
  );
  return parsed.success ? parsed.data : undefined;
}

/** Draws the app with this icon from now on. */
export async function writeAppIcon(
  slug: AppSlug,
  icon: AppIconValue,
): Promise<void> {
  await setKeys([{ key: appIconKey(slug), t: "set", value: icon }]);
}

/**
 * What the store holds for an app, its icon included, as one string that
 * changes when any of it does: what a chat's agent is told an app changed by.
 */
export async function appFingerprint(slug: AppSlug): Promise<string> {
  const store = await appsStore();
  return createHash("sha256")
    .update(
      JSON.stringify([
        store.get(appKey(slug)) ?? null,
        store.get(appIconKey(slug)) ?? null,
      ]),
    )
    .digest("base64url");
}

function appInfoOf(name: string, app: AppFile): AppInfo {
  return {
    manifest: app.manifest,
    manifestHash: manifestHash(app.manifest),
    name,
    slug: app.id,
  };
}

/** The app, or why there is none to write to. */
async function requireApp(slug: AppSlug): Promise<AppInfo> {
  const loaded = await loadApp(slug);
  if (loaded.isErr()) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

/** Writes a manifest over the app's, keeping everything else about it. */
async function writeManifest(
  slug: AppSlug,
  manifest: AppManifest,
): Promise<AppManifest> {
  await writeApps((store) => {
    const value = appValueOf(store.get(appKey(slug)));
    const read = value ? readValue(slug, value) : undefined;
    if (!value || read?.kind !== "app") {
      throw new Error(`"${slug}" is not an app.`);
    }
    return {
      ops: [
        {
          key: appKey(slug),
          t: "set",
          value: appValue({
            app: { ...read.app, manifest },
            kept: value,
            name: value.name,
          }),
        },
      ],
      result: undefined,
    };
  });
  return manifest;
}
