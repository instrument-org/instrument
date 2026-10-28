import { APP_NAME } from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { omit } from "radashi";

import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import { readOwnFile, writeOwnFile } from "../own-file";
import { shellPath } from "../shell-path";
import { macAppNamed } from "../mac-apps/apps";
import { APP_COMMAND } from "../shell-commands/app-command";
import { macAppGuide } from "./mac-app-guide";
import {
  type AppFile,
  APP_FILE_NAME,
  type AppFileRead,
  APPS_FOLDER_NAME,
  parseAppFile,
  renderAppFile,
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

export interface AppInfo {
  dir: AbsolutePath;
  manifest: AppManifest;
  /** What the connection record is pinned to: the manifest as it is on disk. */
  manifestHash: string;
  /** What the person calls it: the name of its folder. */
  name: string;
  slug: AppSlug;
}

interface AppLoadError {
  message: string;
  reason: "invalid-manifest" | "invalid-slug" | "not-found";
}

/**
 * Read every app folder under `appsDir`. A folder with no `APP.md` is not an
 * app's and is passed over; one whose `APP.md` names an app this build cannot
 * read is returned separately, so callers (the Apps screen, `instrument app list`) can
 * say so instead of letting the app disappear.
 *
 * Two folders carrying one `id` is a copy-paste: the first by name is the
 * app, and the other is reported, since whichever way they were told apart
 * would be a guess at which one the key belongs to.
 */
export async function listApps(appsDir: AbsolutePath): Promise<{
  apps: AppInfo[];
  invalid: { message: string; slug: string }[];
}> {
  const apps: AppInfo[] = [];
  const invalid: { message: string; slug: string }[] = [];
  const taken = new Map<string, string>();

  for (const { folder, read } of await readAppFolders(appsDir)) {
    if (read.kind === "none" || read.kind === "unreadable") {
      continue;
    }
    if (read.kind === "invalid") {
      invalid.push({ message: read.message, slug: read.id });
      continue;
    }
    const first = taken.get(read.app.id);
    if (first !== undefined) {
      invalid.push({
        message: `"${folder}" says it is "${read.app.id}", which "${first}" already is. Give one of them an id of its own, or take it away.`,
        slug: read.app.id,
      });
      continue;
    }
    taken.set(read.app.id, folder);
    apps.push(appInfoOf(appsDir, folder, read.app));
  }

  return { apps, invalid };
}

/**
 * One app by its id, found by reading the apps folder: its name is its
 * folder's, which the person may rename at any time, so nothing but the `id`
 * in its `APP.md` says which app a folder holds. A handful of small files, so
 * no cache stands between the folder and the answer.
 */
export async function loadApp(
  appsDir: AbsolutePath,
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
  let broken: string | undefined;
  for (const { folder, read } of await readAppFolders(appsDir)) {
    if (read.kind === "app" && read.app.id === slug) {
      return ok(appInfoOf(appsDir, folder, read.app));
    }
    if (read.kind === "invalid" && read.id === slug) {
      broken ??= read.message;
    }
  }
  return broken === undefined
    ? err({
        message: `No app is "${slug}": no ${APP_FILE_NAME} in ${APPS_FOLDER_NAME}/ gives that as its id.`,
        reason: "not-found",
      })
    : err({ message: broken, reason: "invalid-manifest" });
}

/** The app's guide: the body of its `APP.md`, or nothing where it has none. */
export function readAppGuide(appDir: AbsolutePath): Promise<null | string> {
  let text: string | undefined;
  try {
    text = readAppFileText(path.dirname(appDir), path.basename(appDir));
  } catch {
    // Unreadable for now: nothing to show.
  }
  const read = parseAppFile(text ?? "");
  return Promise.resolve(
    read.kind === "app" && read.app.guide !== "" ? `${read.app.guide}\n` : null,
  );
}

/**
 * Writes the app's guide, keeping the manifest above it and every key found
 * with it, since the guide is the body of the one file the manifest is in.
 */
export function writeAppGuide(appDir: AbsolutePath, guide: string) {
  const appsDir = path.dirname(appDir);
  const read = parseAppFile(
    readAppFileText(appsDir, path.basename(appDir)) ?? "",
  );
  if (read.kind !== "app") {
    throw new Error(
      `${path.join(appDir, APP_FILE_NAME)} is not an app, so there is no guide to write.`,
    );
  }
  writeOwnFile({
    data: renderAppFile({ ...read.app, guide }),
    file: path.join(appDir, APP_FILE_NAME),
    folder: appsDir,
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
 * It opens with no heading: the folder is the app's name, and the guide is
 * the body of the file under it.
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
  appsDir: AbsolutePath,
  slug: AppSlug,
  account: string | undefined,
): Promise<AppManifest> {
  const current = (await requireApp(appsDir, slug)).manifest;
  const rest = omit(current, ["account"]);
  if (account === undefined) {
    return writeManifest(appsDir, slug, AppManifestSchema.parse(rest));
  }
  const accountHome =
    current.type === "web"
      ? catalogEntryForApp(slug, current)?.accountHome
      : undefined;
  return writeManifest(
    appsDir,
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
 * Writes an app's folder: its `APP.md`, the manifest as front matter over the
 * guide. An app already here keeps the folder it is in, whatever the person
 * has renamed it to, and keeps the guide unless `replacesGuide` says the
 * service is reached another way now. A new one takes `name` as its folder,
 * numbered where another app has that name, which is what a second account
 * of one service comes to.
 */
export async function writeAppFolder({
  appsDir,
  guide,
  manifest,
  name,
  replacesGuide = false,
  slug,
}: {
  appsDir: AbsolutePath;
  guide: string;
  manifest: AppManifest;
  /** What the app is called, and so what its folder is called when it is new. */
  name: string;
  /** Writes the guide over one already there, for a manifest that reaches the service another way. */
  replacesGuide?: boolean;
  slug: AppSlug;
}): Promise<AbsolutePath> {
  const found = await findApp(appsDir, slug);
  if (found?.kind === "invalid") {
    // Writing a folder beside it would make two apps of one id, the new one
    // taking the key and connection while the person's guide stays in the
    // broken file.
    throw new Error(
      `${shellPath(path.join(found.dir, APP_FILE_NAME))} is already "${slug}" and cannot be read: ${found.message} Fix that file rather than writing another.`,
    );
  }
  if (found?.kind === "unreadable") {
    // It may be this app, so a folder beside it could be a second of one id.
    throw new Error(
      `${shellPath(path.join(found.dir, APP_FILE_NAME))} could not be read, and may already be "${slug}". Try again once it can be read.`,
    );
  }
  const here = found?.kind === "app" ? found.app : undefined;
  const dir =
    here?.dir ??
    absolutePathJoin(
      appsDir,
      unusedAppName(name, await appFolderNames(appsDir)),
    );
  const kept = here === undefined || replacesGuide ? "" : here.guide;
  writeOwnFile({
    data: renderAppFile({
      guide: kept || guide,
      id: slug,
      manifest,
      ...(here?.others ? { others: here.others } : {}),
    }),
    file: path.join(dir, APP_FILE_NAME),
    folder: appsDir,
  });
  return dir;
}

/** The folders in the apps folder, in name order; none where there is no such folder. */
async function appFolderNames(appsDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(appsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * Why there is no `APP.md` to read in a folder: no such file, or a link or
 * folder at its name. Anything else (another program holding it, a file
 * iCloud has yet to bring down) leaves the file there and unread.
 */
const NO_APP_FILE = new Set(["EISDIR", "ELOOP", "ENOENT", "ENOTDIR"]);

/**
 * An app's file as text, read as the app itself rather than through the
 * sandbox: a program the agent runs can put a link at any name in here, and
 * nothing on the way to the file is followed (`readOwnFile`). Undefined where
 * the folder has no such file; throws for one it could not read.
 */
function readAppFileText(appsDir: string, folder: string): string | undefined {
  try {
    return readOwnFile({
      file: path.join(appsDir, folder, APP_FILE_NAME),
      folder: appsDir,
    }).toString("utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      NO_APP_FILE.has(error.code)
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Every folder in the apps folder with what its `APP.md` says, in name order.
 * One whose file could not be read is `unreadable`: it may be any app.
 */
async function readAppFolders(appsDir: AbsolutePath): Promise<
  {
    folder: string;
    read: AppFileRead | { kind: "unreadable"; message: string };
  }[]
> {
  return (await appFolderNames(appsDir)).map((folder) => {
    try {
      return {
        folder,
        read: parseAppFile(readAppFileText(appsDir, folder) ?? ""),
      };
    } catch (error) {
      return {
        folder,
        read: {
          kind: "unreadable" as const,
          message: `${APP_FILE_NAME} could not be read: ${String(error)}`,
        },
      };
    }
  });
}

function appInfoOf(
  appsDir: AbsolutePath,
  folder: string,
  app: AppFile,
): AppInfo {
  return {
    dir: absolutePathJoin(appsDir, folder),
    manifest: app.manifest,
    manifestHash: manifestHash(app.manifest),
    name: folder,
    slug: app.id,
  };
}

/**
 * The app as its file holds it, with the folder it is in: what a write that
 * keeps the rest of the file needs. A file that gives the id and cannot be
 * read is found too, so nothing writes a second app of that id. Nothing where
 * no folder gives that id.
 */
async function findApp(
  appsDir: AbsolutePath,
  slug: AppSlug,
): Promise<
  | { app: AppFile & { dir: AbsolutePath }; kind: "app" }
  | { dir: AbsolutePath; kind: "invalid" | "unreadable"; message: string }
  | undefined
> {
  let broken:
    | { dir: AbsolutePath; kind: "invalid" | "unreadable"; message: string }
    | undefined;
  for (const { folder, read } of await readAppFolders(appsDir)) {
    const dir = absolutePathJoin(appsDir, folder);
    if (read.kind === "app" && read.app.id === slug) {
      return { app: { ...read.app, dir }, kind: "app" };
    }
    if (
      read.kind === "invalid" &&
      read.id === slug &&
      broken?.kind !== "invalid"
    ) {
      broken = { dir, kind: "invalid", message: read.message };
    }
    if (read.kind === "unreadable") {
      broken ??= { dir, kind: "unreadable", message: read.message };
    }
  }
  return broken;
}

/** The app, or why there is none to write to. */
async function requireApp(
  appsDir: AbsolutePath,
  slug: AppSlug,
): Promise<AppFile & { dir: AbsolutePath }> {
  const found = await findApp(appsDir, slug);
  if (found?.kind !== "app") {
    const loaded = await loadApp(appsDir, slug);
    throw new Error(
      loaded.isErr() ? loaded.error.message : `"${slug}" is not an app.`,
    );
  }
  return found.app;
}

/** Writes a manifest over the one in the app's file, keeping everything else in it. */
async function writeManifest(
  appsDir: AbsolutePath,
  slug: AppSlug,
  manifest: AppManifest,
): Promise<AppManifest> {
  const app = await requireApp(appsDir, slug);
  writeOwnFile({
    data: renderAppFile({ ...app, manifest }),
    file: path.join(app.dir, APP_FILE_NAME),
    folder: appsDir,
  });
  return manifest;
}
