import fs from "node:fs/promises";
import path from "node:path";

import {
  APP_FILE_NAME,
  type AppFileRead,
  appFileOf,
  APPS_FOLDER_NAME,
  parseAppFile,
  renderAppFile,
  unusedAppName,
} from "./apps/app-file";
import { type AppConnectionStore } from "./apps/connection";
import { manifestHash } from "./apps/manifest";
import { type FolderMoved, moveOutOfDataDir } from "./move-out-of-data-dir";
import { isRecord } from "./skills";
import { WORKSPACE_DATA_ENTRIES, workspaceLayout } from "./workspace-layout";

export type AppsMoved = FolderMoved;

/** Where an app's setup was, in a file of its own. */
const MANIFEST_FILE_NAME = "app.json";

/** Where an app's guide was, in a file of its own. */
const GUIDE_FILE_NAME = "guide.md";

/**
 * Brings the apps an earlier build hid in the workspace's `.instrument/` out
 * to `Apps/` at its top level; see {@link moveOutOfDataDir} for the rules
 * every one of these moves keeps.
 *
 * The folder alone is moved here. What is in each app folder is still the two
 * files an earlier build wrote, which {@link convertAppsToAppFiles} turns
 * into the one `APP.md` a person reads, and which it does whether this move
 * had anything to move or not.
 */
export function moveAppsToFolder(rootDir: string): Promise<AppsMoved> {
  return moveOutOfDataDir({
    from: path.join(
      workspaceLayout(rootDir).dataDir,
      WORKSPACE_DATA_ENTRIES.apps,
    ),
    name: APPS_FOLDER_NAME,
    rootDir,
  });
}

/** What the conversion came to, for the boot log. */
export interface AppFilesConverted {
  /** A line per app converted. */
  done: string[];
  /** Each app folder left as it was, with why. */
  left: { reason: string; where: string }[];
}

/**
 * Turns each app's two files into the one file the person opens: an
 * `app.json` and a `guide.md` in `Apps/<slug>/` become the front matter and
 * the body of an `APP.md`, in a folder named for the app rather than for its
 * slug, which the front matter's `id` now carries.
 *
 * An app that was connected stays connected: the approval on record is
 * pinned to a digest of the manifest, and dropping `name` and renaming
 * `baseUrl` change that digest, so a record pinned to the old one is
 * restamped with the new (`restampConnection`). A record pinned to neither
 * was stale before this ran and is left for the app to test again.
 *
 * Safe to run again: a folder with no `app.json` has nothing left to do, and
 * one whose `APP.md` is already written keeps it. The old files go only once
 * the new one has been written, read back as the app it was written from, and
 * the approval carried, so a conversion that fails halfway leaves a readable
 * app behind either way.
 */
export async function convertAppsToAppFiles(
  rootDir: string,
  { connections }: { connections: AppConnectionStore },
): Promise<AppFilesConverted> {
  const converted: AppFilesConverted = { done: [], left: [] };
  const dir = path.join(rootDir, APPS_FOLDER_NAME);
  let names: string[];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return converted;
  }
  const taken = new Set(names);
  for (const name of names) {
    try {
      const line = await convertAppFolder({
        connections,
        folder: name,
        in: dir,
        taken,
      });
      if (line) {
        converted.done.push(line);
      }
    } catch (error) {
      converted.left.push({
        reason: String(error),
        where: path.join(dir, name),
      });
    }
  }
  return converted;
}

/**
 * One app folder as an `APP.md` in a folder named for the app, and the line
 * that says so; nothing for a folder there was nothing to do to.
 */
async function convertAppFolder({
  connections,
  folder,
  in: appsDir,
  taken,
}: {
  connections: AppConnectionStore;
  folder: string;
  in: string;
  /** The folder names in use, which a renamed folder leaves and takes. */
  taken: Set<string>;
}): Promise<string | undefined> {
  const was = path.join(appsDir, folder);
  const manifestFile = path.join(was, MANIFEST_FILE_NAME);
  const legacy = await readRecord(manifestFile);
  if (!legacy) {
    // Converted already, or a folder of the person's that was never an app.
    return undefined;
  }
  const already = parseAppFile(
    await fs.readFile(path.join(was, APP_FILE_NAME), "utf8").catch(() => ""),
  );
  // The folder was the app's slug until this runs, and is its name after, so
  // a folder whose `APP.md` is written already is named for the app, and the
  // id in that file is the only thing that still says which app it is.
  const slug = already.kind === "app" ? already.app.id : folder;
  const guide = await fs
    .readFile(path.join(was, GUIDE_FILE_NAME), "utf8")
    .catch(() => "");
  const read = appOf(legacy, { guide, slug });
  if (read.kind !== "app") {
    throw new Error(
      read.kind === "invalid"
        ? `${MANIFEST_FILE_NAME} cannot be read as an app: ${read.message}`
        : `${MANIFEST_FILE_NAME} names no app`,
    );
  }
  const app = read.app;
  if (already.kind !== "app") {
    await fs.writeFile(
      path.join(was, APP_FILE_NAME),
      renderAppFile(app),
      "utf8",
    );
    const again = parseAppFile(
      await fs.readFile(path.join(was, APP_FILE_NAME), "utf8"),
    );
    if (again.kind !== "app" || again.app.id !== app.id) {
      throw new Error(`${APP_FILE_NAME} did not read back as the app`);
    }
  }
  // The folder is the app's name from here on, so it takes the name the
  // manifest carried, numbered where another app already has it.
  const name = unusedAppName(
    typeof legacy.name === "string" && legacy.name.trim() ? legacy.name : slug,
    [...taken].filter((entry) => entry !== folder),
  );
  const dir = path.join(appsDir, name);
  if (name !== folder) {
    await fs.rename(was, dir);
    taken.delete(folder);
    taken.add(name);
  }
  await restampConnection({
    connections,
    now: manifestHash(app.manifest),
    slug: app.id,
    was: manifestHash(legacy),
  });
  await fs.rm(path.join(dir, MANIFEST_FILE_NAME), { force: true });
  await fs.rm(path.join(dir, GUIDE_FILE_NAME), { force: true });
  return `converted ${folder} to ${name}/${APP_FILE_NAME}`;
}

/**
 * The app the two old files held: the manifest with its slug as `id`, with
 * `name` dropped, since the folder is the name now, and an API app's
 * `baseUrl` under the `url` every kind of app uses. Read by the same reader
 * every `APP.md` goes through, so a key this build does not know comes across
 * with them and nothing is coerced twice.
 */
function appOf(
  legacy: Record<string, unknown>,
  { guide, slug }: { guide: string; slug: string },
): AppFileRead {
  const { baseUrl, name: _name, ...rest } = legacy;
  return appFileOf(
    {
      ...rest,
      ...(baseUrl === undefined ? {} : { url: baseUrl }),
      id: slug,
    },
    { guide },
  );
}

/** What an app's old manifest held, or nothing where there is no readable one. */
async function readRecord(
  file: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Carries an app's connection across the change to its manifest: a record
 * pinned to the manifest as the build before this one hashed it is pinned to
 * the same manifest as this one hashes it, and everything else about the
 * record is left alone. One pinned to neither was stale already, so it stays
 * that way and the app tests again.
 */
async function restampConnection({
  connections,
  now,
  slug,
  was,
}: {
  connections: AppConnectionStore;
  now: string;
  slug: string;
  was: string;
}): Promise<void> {
  const record = await connections.get(slug);
  if (!record) {
    return;
  }
  const next = {
    ...record,
    ...(record.manifestHash === was ? { manifestHash: now } : {}),
    ...(record.approvedManifestHash === was
      ? { approvedManifestHash: now }
      : {}),
  };
  if (
    next.manifestHash !== record.manifestHash ||
    next.approvedManifestHash !== record.approvedManifestHash
  ) {
    await connections.set(slug, next);
  }
}
