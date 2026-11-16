import { splitFrontMatter } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { omit } from "radashi";
import { parse as parseYaml } from "yaml";

import {
  APP_FILE_NAME,
  type AppFile,
  appFileOf,
  APPS_FOLDER_NAME,
  unusedAppName,
} from "./apps/app-file";
import { type AppConnectionStore } from "./apps/connection";
import { readIconInFolder } from "./apps/icon";
import { AppSlugSchema, manifestHash } from "./apps/manifest";
import { appIconKey, appKey, appsStore } from "./apps/store";
import { type SyncedStore } from "./synced-store/synced-store";
import { type DeviceId } from "./records/device-id";
import { readOldFile } from "./read-old-file";
import { isRecord } from "./skills";
import { type SyncedOp } from "./synced-store/synced-record";
import { WORKSPACE_DATA_ENTRIES, workspaceLayout } from "./workspace-layout";

/** Where an app's setup was, in a file of its own. */
const MANIFEST_FILE_NAME = "app.json";

/** Where an app's guide was, in a file of its own. */
const GUIDE_FILE_NAME = "guide.md";

/** What taking the app folders in came to, for the boot log. */
export interface AppFoldersTaken {
  /** A line per app taken in, and per folder sent to the Trash. */
  done: string[];
  /** Each app folder left as it was, with why. */
  left: { reason: string; where: string }[];
}

/**
 * Takes every app an earlier build kept in a folder into the apps store
 * (`apps/store.ts`), then sends the folder to the Trash: `Apps/` at the
 * workspace's top level, a folder per app named for it with its `APP.md`,
 * and the `.instrument/apps/` the betas before it kept, a folder per app
 * named for its slug with an `app.json` and a `guide.md` (which an `Apps/`
 * folder can hold too, moved out and never converted).
 *
 * Run at every launch, since a computer still on an earlier build writes
 * `Apps/` again. Each app is written as of its file's last change, so one
 * the store has changed since is left as the store has it, and a second run
 * over the same folder writes nothing. Front matter this build does not read
 * is kept in the app's setup. A legacy app that was connected stays
 * connected: the approval on record is pinned to a digest of the manifest,
 * and dropping `name` and renaming `baseUrl` change that digest, so a record
 * pinned to the old one is restamped with the new.
 *
 * A folder goes to the Trash only once every app in it is in the store: one
 * whose file could not be read is left, with the folder around it, for the
 * next launch.
 */
export async function takeInAppFolders(
  rootDir: string,
  {
    connections,
    device,
    trash,
  }: {
    connections: AppConnectionStore;
    device: DeviceId;
    trash: (dir: string) => Promise<void>;
  },
): Promise<AppFoldersTaken> {
  const taken: AppFoldersTaken = { done: [], left: [] };
  const layout = workspaceLayout(rootDir);
  const store = await appsStore({ device, devicesDir: layout.devicesDir });
  for (const dir of [
    path.join(layout.dataDir, WORKSPACE_DATA_ENTRIES.apps),
    path.join(rootDir, APPS_FOLDER_NAME),
  ]) {
    const names = await folderNames(dir);
    if (names === undefined) {
      continue;
    }
    let leftHere = false;
    for (const folder of names) {
      try {
        const app = await readAppFolder(path.join(dir, folder), folder, store);
        if (app === undefined) {
          continue;
        }
        await store.apply(app.ops);
        if (app.legacyHash !== undefined && app.hash !== "") {
          await restampConnection({
            connections,
            now: app.hash,
            slug: app.slug,
            was: app.legacyHash,
          });
        }
        taken.done.push(`took in ${path.join(dir, folder)} as ${app.slug}`);
      } catch (error) {
        leftHere = true;
        taken.left.push({
          reason: String(error),
          where: path.join(dir, folder),
        });
      }
    }
    if (!leftHere) {
      await trash(dir);
      taken.done.push(`sent ${dir} to the Trash`);
    }
  }
  return taken;
}

/**
 * The writes that take one app folder in, or nothing for a folder that holds
 * no app (something else the person left there). Its `APP.md` says what the
 * app is where it has one, and its `app.json` and `guide.md` where it has
 * none. Throws for a file that could not be read, or one that names an app
 * it cannot say anything about.
 */
async function readAppFolder(
  dir: string,
  folder: string,
  store: SyncedStore,
): Promise<
  | {
      hash: string;
      /** The manifest's digest as the build that wrote `app.json` took it. */
      legacyHash?: string;
      ops: SyncedOp[];
      slug: string;
    }
  | undefined
> {
  const appFile = await readOldFile(path.join(dir, APP_FILE_NAME));
  const front = appFile === undefined ? undefined : frontMatterOf(appFile);
  const legacy = await readRecord(path.join(dir, MANIFEST_FILE_NAME));
  const legacyHash = legacy ? { legacyHash: manifestHash(legacy) } : {};
  if (front?.kind === "broken") {
    throw new Error(front.message);
  }
  const said = typeof front?.setup.id === "string" ? front.setup.id.trim() : "";
  if (front && said !== "") {
    const id = AppSlugSchema.safeParse(said);
    if (!id.success) {
      throw new Error(
        `"${said}" is not an app id (lowercase letters, digits, and hyphens).`,
      );
    }
    // Written whatever its manifest says, valid or not: the Apps page and
    // `instrument app list` say what is wrong with one, where it can be
    // fixed.
    const setup = omit(front.setup, ["id"]);
    const read = appFileOf(
      { ...setup, id: id.data },
      { guide: front.guide, what: APP_FILE_NAME },
    );
    const at = await changedAt(path.join(dir, APP_FILE_NAME));
    return {
      hash: read.kind === "app" ? manifestHash(read.app.manifest) : "",
      ...legacyHash,
      ops: [
        {
          at,
          key: appKey(id.data),
          t: "set",
          value: { guide: front.guide.trim(), name: folder, setup },
        },
        ...(await iconOps(dir, id.data, at)),
      ],
      slug: id.data,
    };
  }
  if (!legacy) {
    return undefined;
  }
  // The folder's name was its app's slug in the builds that wrote `app.json`,
  // and the name was the manifest's own, which two apps of one service
  // shared; the second is numbered, as `instrument app new` numbers one.
  const guide = (await readOldFile(path.join(dir, GUIDE_FILE_NAME))) ?? "";
  const { baseUrl, name, ...rest } = legacy;
  const read = appFileOf(
    { ...rest, ...(baseUrl === undefined ? {} : { url: baseUrl }), id: folder },
    { guide, what: MANIFEST_FILE_NAME },
  );
  if (read.kind !== "app") {
    throw new Error(
      read.kind === "invalid"
        ? read.message
        : `${MANIFEST_FILE_NAME} names no app`,
    );
  }
  return {
    hash: manifestHash(read.app.manifest),
    ...legacyHash,
    ops: await opsFor({
      app: read.app,
      at: await changedAt(path.join(dir, MANIFEST_FILE_NAME)),
      dir,
      name: unusedAppName(
        typeof name === "string" && name.trim() !== "" ? name.trim() : folder,
        namesBesides(store, read.app.id),
      ),
    }),
    slug: read.app.id,
  };
}

/** The names of every app in the store but this one. */
function namesBesides(store: SyncedStore, slug: AppFile["id"]): string[] {
  return [...store.entries("app/")].flatMap(([key, value]) =>
    key !== appKey(slug) && isRecord(value) && typeof value.name === "string"
      ? [value.name]
      : [],
  );
}

/** An `APP.md`'s front matter and guide; `broken` for front matter that is not YAML. */
function frontMatterOf(
  text: string,
):
  | { guide: string; kind: "app"; setup: Record<string, unknown> }
  | { kind: "broken"; message: string }
  | undefined {
  const split = splitFrontMatter(text);
  if (!split.ok) {
    return undefined;
  }
  try {
    const parsed: unknown = parseYaml(split.block);
    return {
      guide: split.body.replaceAll("\r\n", "\n"),
      kind: "app",
      setup: isRecord(parsed) ? parsed : {},
    };
  } catch (error) {
    // Only an app's file that broke is worth keeping the folder for.
    return /^id:/m.test(split.block)
      ? {
          kind: "broken",
          message: `${APP_FILE_NAME}'s front matter is not YAML: ${String(error).split("\n")[0] ?? ""}`,
        }
      : undefined;
  }
}

async function opsFor({
  app,
  at,
  dir,
  name,
}: {
  app: AppFile;
  at: number;
  dir: string;
  name: string;
}): Promise<SyncedOp[]> {
  return [
    {
      at,
      key: appKey(app.id),
      t: "set",
      value: {
        guide: app.guide.trim(),
        name,
        setup: { ...app.others, ...app.manifest },
      },
    },
    ...(await iconOps(dir, app.id, at)),
  ];
}

/** The icon file the folder has, as a write of the app's icon. */
async function iconOps(
  dir: string,
  slug: AppFile["id"],
  at: number,
): Promise<SyncedOp[]> {
  const icon = await readIconInFolder(dir);
  return icon
    ? [
        {
          at,
          key: appIconKey(slug),
          t: "set",
          value: {
            data: icon.bytes.toString("base64"),
            fileName: icon.fileName,
          },
        },
      ]
    : [];
}

/** When a file last changed, in ms: the time an app taken from it is written as of. */
async function changedAt(file: string): Promise<number> {
  return Math.floor((await fs.stat(file)).mtimeMs);
}

/** The folders in `dir`, by name; nothing where there is no such folder. */
async function folderNames(dir: string): Promise<string[] | undefined> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return undefined;
  }
}

/** What an app's old manifest held, or nothing where there is no readable one. */
async function readRecord(
  file: string,
): Promise<Record<string, unknown> | undefined> {
  const text = await readOldFile(file);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
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
