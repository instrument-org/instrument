/**
 * Keeps a release off any channel that already serves a newer version. A
 * stable release goes out on every channel (electron-builder's
 * `generateUpdatesFilesForAllChannels`, and `channelsFor` in
 * velopack-pack.ts), and one is often cut from a commit behind the betas:
 * without this check its feeds would point the beta and alpha channels back
 * at it, and Velopack refuses to pack a version below a channel's latest.
 *
 *   node release-channels.ts prune <dir> --version <v> [--base <url>]
 *
 * Deletes from `<dir>` every update feed (`*.yml`, `velopack/releases.*.json`)
 * whose live copy under `<base>` names a newer version than `<v>`, so the
 * publish job leaves that feed as it is. Dependency-free so the publish job
 * runs it with Node alone.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { RELEASES_BUCKET_URL } from "../../../packages/shared/src/constants.ts";

/** Semver precedence of two `x.y.z[-pre]` versions: negative when `a` is lower. */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  const numsA = coreA.split(".").map(Number);
  const numsB = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === undefined || preB === undefined) {
    return (preA === undefined ? 1 : 0) - (preB === undefined ? 1 : 0);
  }
  const partsA = preA.split(".");
  const partsB = preB.split(".");
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i];
    const y = partsB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numeric = /^\d+$/;
    if (numeric.test(x) && numeric.test(y)) return Number(x) - Number(y);
    if (numeric.test(x)) return -1;
    if (numeric.test(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function splitVersion(version: string): [string, string | undefined] {
  const dash = version.indexOf("-");
  return dash === -1
    ? [version, undefined]
    : [version.slice(0, dash), version.slice(dash + 1)];
}

/**
 * The version an update feed serves: electron-builder's YAML (`version:`),
 * the JSON the Mac feeds are merged into, or Velopack's `releases.<channel>.json`
 * (the highest of its `Assets`).
 */
export function feedVersion(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      if ("version" in parsed && typeof parsed.version === "string") {
        return parsed.version;
      }
      if ("Assets" in parsed && Array.isArray(parsed.Assets)) {
        const versions = parsed.Assets.flatMap((asset: unknown) =>
          typeof asset === "object" &&
          asset !== null &&
          "Version" in asset &&
          typeof asset.Version === "string"
            ? [asset.Version]
            : [],
        );
        return versions.sort(compareVersions).at(-1);
      }
    }
  } catch {
    // Not JSON: electron-builder's YAML.
  }
  return /^version:\s*["']?([^"'\s]+)/m.exec(text)?.[1];
}

/** The version the live feed `live` serves, when newer than `version`. */
export function newerServed(version: string, live: string | undefined) {
  const served = live === undefined ? undefined : feedVersion(live);
  return served !== undefined && compareVersions(served, version) > 0
    ? served
    : undefined;
}

/**
 * A feed file's live text, from a URL or a folder of releases; undefined when
 * there is none yet. Any other failure throws, since guessing would either
 * lower a channel or leave one behind.
 */
export async function readFeedFile(base: string, name: string) {
  if (!/^https?:\/\//i.test(base)) {
    const file = path.join(base, name);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }
  const response = await fetch(`${base}/${name}`, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`${base}/${name}: ${response.status}`);
  }
  return response.text();
}

async function prune(dir: string, version: string, base: string) {
  const feeds = [
    ...readdirSync(dir).filter((name) => name.endsWith(".yml")),
    ...(existsSync(path.join(dir, "velopack"))
      ? readdirSync(path.join(dir, "velopack"))
          .filter((name) => /^releases\..+\.json$/.test(name))
          .map((name) => `velopack/${name}`)
      : []),
  ];
  for (const name of feeds) {
    const served = newerServed(version, await readFeedFile(base, name));
    if (served !== undefined) {
      rmSync(path.join(dir, name));
      console.log(
        `::notice::Leaving ${name} at ${served}, newer than ${version}`,
      );
    }
  }
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { base: { type: "string" }, version: { type: "string" } },
  });
  const [command, dir] = positionals;
  if (command !== "prune" || !dir || !values.version) {
    console.error(
      "usage: release-channels.ts prune <dir> --version <v> [--base <url>]",
    );
    process.exit(1);
  }
  await prune(dir, values.version, values.base ?? RELEASES_BUCKET_URL);
}
