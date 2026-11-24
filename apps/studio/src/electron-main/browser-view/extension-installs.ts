import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

import type { ExtensionAccess } from "@/electron-main/stores/workspace/browser-extensions";

import { parseManifest, unpackPackage } from "./extension-package";
import { accessOf, newAccessLines } from "./extension-permissions";
import { compareExtensionVersions } from "./extension-store-updates";
import { log } from "./log";

const EXTENSION_ID = /^[a-p]{32}$/;

const ManifestSchema = z.looseObject({
  default_locale: z.string().optional().catch(undefined),
  description: z.string().catch(""),
  icons: z.record(z.string(), z.string()).catch({}),
  key: z.string(),
  manifest_version: z.number(),
  name: z.string(),
  version: z.string(),
});

/** One version of an extension on this computer. */
export type InstalledVersion = {
  manifest: z.output<typeof ManifestSchema>;
  path: string;
  version: string;
};

/**
 * The versions of each extension on disk, newest first, by extension id; one
 * whose folder cannot be read has none. Null when the folder they are kept
 * in cannot be read, which says nothing about what is installed.
 */
export async function readInstalls(
  extensionsDir: string,
): Promise<Map<string, InstalledVersion[]> | null> {
  let ids: string[];
  try {
    ids = await fs.readdir(extensionsDir);
  } catch (error) {
    const isMissing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    return isMissing ? new Map() : null;
  }
  const installs = new Map<string, InstalledVersion[]>();
  for (const id of ids) {
    if (EXTENSION_ID.test(id)) {
      installs.set(id, await readVersions(path.join(extensionsDir, id)));
    }
  }
  return installs;
}

async function readVersions(dir: string): Promise<InstalledVersion[]> {
  const names = await fs.readdir(dir).catch(() => []);
  const versions: InstalledVersion[] = [];
  for (const name of names) {
    const at = path.join(dir, name);
    try {
      const manifest = ManifestSchema.parse(
        parseManifest(
          await fs.readFile(path.join(at, "manifest.json"), "utf8"),
        ),
      );
      versions.push({ manifest, path: at, version: manifest.version });
    } catch {
      // Not a version's folder, or one that cannot load.
    }
  }
  return versions.toSorted((a, b) =>
    compareExtensionVersions(b.version, a.version),
  );
}

/**
 * Of the versions on disk, newest first: the newest one that asks for
 * nothing past what the person agreed to, and a newer one that does, with
 * what it asks for.
 */
export function chooseVersion(
  versions: readonly InstalledVersion[],
  granted: ExtensionAccess,
): {
  awaiting: null | { lines: string[]; version: InstalledVersion };
  loadable: InstalledVersion | null;
} {
  const loadable =
    versions.find(
      ({ manifest }) =>
        newAccessLines(granted, accessOf(manifest)).length === 0,
    ) ?? null;
  const newest = versions[0];
  return {
    awaiting:
      newest && newest !== loadable
        ? {
            lines: newAccessLines(granted, accessOf(newest.manifest)),
            version: newest,
          }
        : null,
    loadable,
  };
}

/** Where folders are unpacked before they are kept, and wait to be deleted. */
function asideDir(extensionsDir: string): string {
  return path.join(path.dirname(extensionsDir), "extensions-aside");
}

/**
 * Renames a folder, again after a moment when it is refused: Windows refuses
 * while a scanner has a file in it open.
 */
async function rename(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error && error.code;
      if (
        attempt === 5 ||
        !["EACCES", "EBUSY", "EPERM"].includes(String(code))
      ) {
        throw error;
      }
      await sleep(attempt * 200);
    }
  }
}

/** Takes a folder out of use whole, giving where it went; null when there is none. */
async function moveAside(
  extensionsDir: string,
  dir: string,
): Promise<null | string> {
  const aside = path.join(asideDir(extensionsDir), crypto.randomUUID());
  await fs.mkdir(path.dirname(aside), { recursive: true });
  try {
    await rename(dir, aside);
    return aside;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Deletes what earlier installs and removals left aside. */
export async function clearAside(extensionsDir: string): Promise<void> {
  await fs.rm(asideDir(extensionsDir), { force: true, recursive: true });
}

/** Takes an extension's every version off the disk. */
export async function removeInstall(
  extensionsDir: string,
  id: string,
): Promise<void> {
  await moveAside(extensionsDir, path.join(extensionsDir, id));
}

/**
 * Puts a verified package's files where the version is kept, whole or not at
 * all: they are unpacked in a folder beside `extensionsDir` and moved in,
 * unless `refuse` gives a reason its manifest is not to be kept.
 */
export async function addVersion(
  extensionsDir: string,
  id: string,
  verified: { archive: Buffer; key: Buffer },
  refuse: (manifest: unknown) => string | undefined = () => undefined,
): Promise<InstalledVersion> {
  const staging = path.join(asideDir(extensionsDir), crypto.randomUUID());
  try {
    await fs.mkdir(staging, { recursive: true });
    await unpackPackage(verified, staging);
    const manifest = ManifestSchema.parse(
      parseManifest(
        await fs.readFile(path.join(staging, "manifest.json"), "utf8"),
      ),
    );
    if (manifest.manifest_version < 3) {
      throw new Error("the extension is made for an older browser");
    }
    const refusal = refuse(manifest);
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
    const kept = path.join(extensionsDir, id, `${manifest.version}_0`);
    await fs.mkdir(path.dirname(kept), { recursive: true });
    const replaced = await moveAside(extensionsDir, kept);
    try {
      await rename(staging, kept);
    } catch (error) {
      if (replaced) {
        await rename(replaced, kept);
      }
      throw error;
    }
    return { manifest, path: kept, version: manifest.version };
  } finally {
    await fs.rm(staging, { force: true, recursive: true });
  }
}

/** Deletes every version but the ones named. */
export async function removeOtherVersions(
  versions: readonly InstalledVersion[],
  kept: readonly (InstalledVersion | undefined)[],
): Promise<void> {
  for (const version of versions) {
    if (!kept.some((one) => one?.path === version.path)) {
      await fs
        .rm(version.path, { force: true, recursive: true })
        .catch((error: unknown) => {
          log.warn(`an old extension version stays at ${version.path}`, error);
        });
    }
  }
}

/** A manifest's words and icon, for an extension that is not running. */
export async function describeVersion({
  manifest,
  path: dir,
}: InstalledVersion): Promise<{
  description: string;
  icon: null | string;
  name: string;
}> {
  const messages: Record<string, { message: string }> = manifest.default_locale
    ? await fs
        .readFile(
          path.join(dir, "_locales", manifest.default_locale, "messages.json"),
          "utf8",
        )
        .then((text) =>
          z
            .record(z.string(), z.object({ message: z.string() }))
            .parse(parseManifest(text)),
        )
        .catch(() => ({}))
    : {};
  const byKey = new Map(
    Object.entries(messages).map(([key, { message }]) => [
      key.toLowerCase(),
      message,
    ]),
  );
  const said = (text: string) =>
    text.replaceAll(
      /__MSG_(\w+?)__/g,
      (whole, key: string) => byKey.get(key.toLowerCase()) ?? whole,
    );
  const largest = Object.entries(manifest.icons)
    .toSorted(([a], [b]) => Number(a) - Number(b))
    .findLast(([size]) => Number(size) <= 128)?.[1];
  const iconFile = largest && path.resolve(dir, `./${largest}`);
  const icon =
    iconFile && iconFile.startsWith(dir + path.sep)
      ? await fs.readFile(iconFile).then(
          (bytes) =>
            `data:image/${iconFile.endsWith(".svg") ? "svg+xml" : "png"};base64,${bytes.toString("base64")}`,
          () => null,
        )
      : null;
  return {
    description: said(manifest.description),
    icon,
    name: said(manifest.name),
  };
}

/** What Chromium keeps per extension in a profile's folders, named by its id. */
const DATA_FOLDERS = [
  "Local Extension Settings",
  "Managed Extension Settings",
  "Sync Extension Settings",
];

/**
 * Deletes the stored data of extensions that are not installed, from a
 * profile no extension has run in since launch, which is when none of it is
 * open.
 */
export async function removeLeftoverData(
  profileDir: string,
  isInstalled: (id: string) => boolean,
): Promise<string[]> {
  const removed = new Set<string>();
  const removeEntry = async (dir: string, entry: string, id: string) => {
    if (!EXTENSION_ID.test(id) || isInstalled(id)) {
      return;
    }
    try {
      await fs.rm(path.join(dir, entry), { force: true, recursive: true });
      removed.add(id);
    } catch (error) {
      log.warn(`a removed extension's data stays at ${dir}/${entry}`, error);
    }
  };
  for (const folder of DATA_FOLDERS) {
    const dir = path.join(profileDir, folder);
    for (const entry of await fs.readdir(dir).catch(() => [])) {
      await removeEntry(dir, entry, entry);
    }
  }
  const databases = path.join(profileDir, "IndexedDB");
  for (const entry of await fs.readdir(databases).catch(() => [])) {
    const id = /^chrome-extension_([a-p]{32})_/.exec(entry)?.[1];
    if (id) {
      await removeEntry(databases, entry, id);
    }
  }
  return [...removed];
}
