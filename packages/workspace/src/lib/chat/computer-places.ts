import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unique } from "radashi";
import { z } from "zod";

import { type KnownFolder } from "../../types";
import { hasWorkspaceConfig, getWorkspaceConfig } from "../workspace-config";
import { iCloudContainersPath, iCloudDrivePath } from "./icloud-drive";
import { outputFolderPath } from "./output-folder";

const ComputerPlaceSchema = z.object({
  /**
   * What the place is, which is what it wears in the sidebar: home, the
   * folder Instrument keeps its outcomes in, a folder a cloud service keeps
   * in step, a disk, or any other folder.
   */
  kind: z.enum(["cloud", "drive", "folder", "home", "output"]),
  name: z.string(),
  path: z.string(),
});
export const ComputerPlacesSchema = z.object({
  /**
   * The places the sidebar pins until the person changes it: the Instrument
   * folder, home, and the folders a person keeps things in.
   */
  pinned: ComputerPlaceSchema.array(),
  /** The disks and the cloud services' folders: the sidebar's Locations. */
  volumes: ComputerPlaceSchema.array(),
});
type ComputerPlace = z.output<typeof ComputerPlaceSchema>;
export type ComputerPlaces = z.output<typeof ComputerPlacesSchema>;

/**
 * The person's own folders each system's file manager lists, in its order:
 * the Finder's three on a Mac, and the media folders as well where Explorer
 * and the Linux file managers list those too.
 */
const KNOWN_FOLDERS: [KnownFolder, string][] =
  process.platform === "darwin"
    ? [
        ["desktop", "Desktop"],
        ["documents", "Documents"],
        ["downloads", "Downloads"],
      ]
    : [
        ["desktop", "Desktop"],
        ["documents", "Documents"],
        ["downloads", "Downloads"],
        ["pictures", "Pictures"],
        ["music", "Music"],
        ["videos", "Videos"],
      ];

/** What a cloud service's folder under `~/Library/CloudStorage` is called by the service's own name. */
const CLOUD_STORAGE_NAMES: Record<string, string> = {
  Box: "Box",
  Dropbox: "Dropbox",
  GoogleDrive: "Google Drive",
  OneDrive: "OneDrive",
};

/**
 * Where the computer is entered from: the folder Instrument keeps its own
 * outcomes in, which is where what the app made is looked for and so stands
 * first; then the folders a person keeps things in, and every mounted disk
 * and cloud service. The home folder goes by its own name, as the file
 * manager calls it.
 *
 * Nothing here reads inside a folder macOS guards: a guarded place is only
 * looked at from outside, so listing the places never asks the person for
 * anything. Opening one is when macOS asks.
 */
export async function computerPlaces(): Promise<ComputerPlaces> {
  const home = os.homedir();
  const known = hasWorkspaceConfig()
    ? getWorkspaceConfig().knownFolders
    : undefined;
  const candidates: ComputerPlace[] = [
    { kind: "output", name: "Instrument", path: outputFolderPath() },
    { kind: "home", name: path.basename(home), path: home },
    ...KNOWN_FOLDERS.map(
      ([key, name]): ComputerPlace => ({
        kind: "folder",
        name,
        path: known?.[key] ?? path.join(home, name),
      }),
    ),
  ];
  const [folders, iCloudDrive, clouds, drives] = await Promise.all([
    present(candidates),
    iCloudDrivePlace(),
    cloudPlaces(home),
    drivePlaces(home),
  ]);
  return {
    // A known folder the system points at home itself is home, once.
    pinned: unique(folders, (place) => place.path),
    // The cloud ahead of the disks, iCloud Drive first, as the Finder lists
    // its Locations.
    volumes: [...(iCloudDrive ? [iCloudDrive] : []), ...clouds, ...drives],
  };
}

/**
 * iCloud Drive, when the computer has iCloud
 * containers at all. Its own folder is inside what macOS guards, so whether
 * it is there is judged from the containers' folder, which is not.
 */
async function iCloudDrivePlace(): Promise<ComputerPlace | undefined> {
  if (
    process.platform !== "darwin" ||
    !(await isDirectory(iCloudContainersPath()))
  ) {
    return undefined;
  }
  return { kind: "cloud", name: "iCloud Drive", path: iCloudDrivePath() };
}

/**
 * The folders cloud services keep in step: on a Mac, each one the system's
 * file provider keeps under `~/Library/CloudStorage`; on Windows, OneDrive
 * where it says it is; and the folders the older desktop apps put in the
 * home folder everywhere.
 */
async function cloudPlaces(home: string): Promise<ComputerPlace[]> {
  const fromProvider =
    process.platform === "darwin" ? await cloudStoragePlaces(home) : [];
  const fromEnvironment =
    process.platform === "win32"
      ? [
          process.env.OneDriveConsumer,
          process.env.OneDriveCommercial,
          process.env.OneDrive,
        ]
          .filter((folder): folder is string => Boolean(folder))
          .map(
            (folder): ComputerPlace => ({
              kind: "cloud",
              name: path.basename(folder),
              path: folder,
            }),
          )
      : [];
  const inHome: ComputerPlace[] = [
    { kind: "cloud", name: "Dropbox", path: path.join(home, "Dropbox") },
    { kind: "cloud", name: "Box", path: path.join(home, "Box") },
    ...(process.platform === "win32"
      ? [
          {
            kind: "cloud" as const,
            name: "iCloud Drive",
            path: path.join(home, "iCloudDrive"),
          },
        ]
      : []),
  ];
  // The newer apps leave a link in the home folder to where the provider
  // keeps them; the link and its target are one place, listed once.
  const legacy = await Promise.all(
    (await present([...fromEnvironment, ...inHome])).map(async (place) => ({
      place,
      real: await fs.realpath(place.path).catch(() => place.path),
    })),
  );
  const providerPaths = new Set(fromProvider.map((place) => place.path));
  return unique(
    [
      ...fromProvider,
      ...legacy
        .filter(({ real }) => !providerPaths.has(real))
        .map(({ place }) => place),
    ],
    (place) => place.path,
  );
}

/**
 * The file provider's folders, named the way the Finder names them: by the
 * service, and by the account too when one service has two.
 */
async function cloudStoragePlaces(home: string): Promise<ComputerPlace[]> {
  const root = path.join(home, "Library", "CloudStorage");
  let names: string[];
  try {
    names = (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const parsed = names.map((name) => {
    const [service = name, ...account] = name.split("-");
    return {
      account: account.join("-"),
      folder: name,
      service: CLOUD_STORAGE_NAMES[service] ?? service,
    };
  });
  return parsed
    .map(
      ({ account, folder, service }): ComputerPlace => ({
        kind: "cloud",
        name:
          account !== "" &&
          parsed.filter((other) => other.service === service).length > 1
            ? `${service} (${account})`
            : service,
        path: path.join(root, folder),
      }),
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * The disks: every volume a Mac mounts, every Windows drive letter with a
 * disk behind it, and on Linux the root and whatever the desktop mounted for
 * the person.
 */
async function drivePlaces(home: string): Promise<ComputerPlace[]> {
  if (process.platform === "darwin") {
    // The boot volume is a link to `/`; the others are themselves.
    return realFolders("/Volumes");
  }
  if (process.platform === "win32") {
    // A and B are the floppy letters, which a machine with no floppy can
    // still answer for slowly.
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    return present(
      letters.map(
        (letter): ComputerPlace => ({
          kind: "drive",
          name: `${letter}:`,
          path: `${letter}:\\`,
        }),
      ),
    );
  }
  const user = path.basename(home);
  const mounted = await Promise.all([
    realFolders(path.join("/media", user)),
    realFolders(path.join("/run/media", user)),
  ]);
  return [
    { kind: "drive", name: "Root", path: path.parse(home).root },
    ...mounted.flat(),
  ];
}

/** The folders in a folder, each where it really is, as disks. */
async function realFolders(folder: string): Promise<ComputerPlace[]> {
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names
      .filter((name) => !name.startsWith("."))
      .map(async (name): Promise<ComputerPlace | undefined> => {
        try {
          const real = await fs.realpath(path.join(folder, name));
          return (await isDirectory(real))
            ? { kind: "drive", name, path: real }
            : undefined;
        } catch {
          return undefined;
        }
      }),
  );
  return found.filter((place) => place !== undefined);
}

/** The places that are there, in the order given. */
async function present(places: ComputerPlace[]): Promise<ComputerPlace[]> {
  const found = await Promise.all(
    places.map(async (place) =>
      (await isDirectory(place.path)) ? place : undefined,
    ),
  );
  return found.filter((place) => place !== undefined);
}

async function isDirectory(folder: string) {
  try {
    const stats = await fs.stat(folder);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
