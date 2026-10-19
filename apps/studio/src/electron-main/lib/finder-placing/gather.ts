import { type Identity, identityOf } from "../file-journal";
import { finderEntries } from "../mac-native";
import {
  type Answer,
  type ItemKind,
  type NameRules,
  type PlaceEntry,
  type PlaceRequest,
  sameIdentity,
} from "./plan";
import { copyName, osOf } from "@/shared/os-conventions";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** What `gatherPlaceRequest` reads the file system through, for a test to stand in for. */
export type GatherSeams = {
  /** How the destination's disk compares names; probed when left out. */
  names?: (folder: string) => Promise<NameRules>;
  /** The packages among a folder's entries, by name. */
  packagesIn?: (folder: string) => Promise<ReadonlySet<string>>;
};

/** Each folder from `at` up to the top, nearest first, by identity. */
async function chainOf(at: string): Promise<Identity[]> {
  const chain: Identity[] = [];
  let here = at;
  for (;;) {
    const identity = await identityOf(here);
    if (identity) {
      chain.push(identity);
    }
    const up = path.dirname(here);
    if (up === here) {
      return chain;
    }
    here = up;
  }
}

async function kindOf(
  at: string,
  packages: ReadonlySet<string>,
): Promise<ItemKind | null> {
  const stats = await fs.lstat(at).catch(() => null);
  if (!stats) {
    return null;
  }
  if (stats.isSymbolicLink()) {
    return "link";
  }
  if (stats.isDirectory()) {
    return packages.has(path.basename(at)) ? "package" : "folder";
  }
  return "file";
}

async function finderPackages(folder: string): Promise<ReadonlySet<string>> {
  const entries = await finderEntries(folder).catch(() => []);
  return new Set(
    entries.flatMap((entry) => (entry.package ? [entry.name] : [])),
  );
}

/**
 * Whether the disk under `folder` tells names apart by case, read without
 * writing anything: the same path with one letter's case flipped names the
 * same folder on a disk that does not. Where no letter is on the way up, the
 * system's default disk answers. The Mac's disks also treat a composed and a
 * decomposed accent as one name, and the others do not.
 */
async function probeNames(folder: string): Promise<NameRules> {
  const unicodeSensitive = process.platform !== "darwin";
  const real = await fs.realpath(folder).catch(() => folder);
  let here = real;
  for (;;) {
    const base = path.basename(here);
    const flipped = Array.from(base)
      .map((char) =>
        char.toLowerCase() === char ? char.toUpperCase() : char.toLowerCase(),
      )
      .join("");
    if (flipped !== base) {
      const [one, other] = await Promise.all([
        identityOf(here),
        identityOf(path.join(path.dirname(here), flipped)),
      ]);
      return {
        caseSensitive: !(one && other && sameIdentity(one, other)),
        unicodeSensitive,
      };
    }
    const up = path.dirname(here);
    if (up === here) {
      return {
        caseSensitive: process.platform === "linux",
        unicodeSensitive,
      };
    }
    here = up;
  }
}

/**
 * Everything the planner needs about a drop or paste into `folder`, read off
 * the file system now: the destination and what is in it, how its disk
 * compares names, and each source. A source that is not there is left out.
 */
export async function gatherPlaceRequest(
  {
    answers = {},
    folder,
    op,
    paths,
  }: {
    answers?: Readonly<Record<string, Answer>>;
    folder: string;
    op: "copy" | "move";
    paths: readonly string[];
  },
  { names = probeNames, packagesIn = finderPackages }: GatherSeams = {},
): Promise<PlaceRequest> {
  const destination = await fs.realpath(folder);
  const destinationStats = await fs.stat(destination);
  const packages = await packagesIn(destination);
  const entries: PlaceEntry[] = [];
  for (const name of await fs.readdir(destination)) {
    const at = path.join(destination, name);
    const [identity, kind] = await Promise.all([
      identityOf(at),
      kindOf(at, packages),
    ]);
    if (identity && kind) {
      entries.push({ identity, kind, name });
    }
  }
  const sources: PlaceRequest["sources"][number][] = [];
  const packagesByFolder = new Map<string, ReadonlySet<string>>();
  for (const at of paths) {
    const parent = path.dirname(at);
    let here = packagesByFolder.get(parent);
    if (!here) {
      here = await packagesIn(parent);
      packagesByFolder.set(parent, here);
    }
    const [identity, kind, stats] = await Promise.all([
      identityOf(at),
      kindOf(at, here),
      fs.lstat(at).catch(() => null),
    ]);
    if (!identity || !kind || !stats) {
      continue;
    }
    sources.push({
      above: await chainOf(await fs.realpath(parent).catch(() => parent)),
      identity,
      kind,
      name: path.basename(at),
      onDestinationDisk: stats.dev === destinationStats.dev,
      path: at,
    });
  }
  const os = osOf(process.platform);
  return {
    answers,
    copyName: (stem, n) => copyName(os, stem, n),
    entries,
    folder: { chain: await chainOf(destination), path: destination },
    join: (one, name) => path.join(one, name),
    names: await names(destination),
    op,
    sources,
    token: randomUUID().slice(0, 8),
  };
}
