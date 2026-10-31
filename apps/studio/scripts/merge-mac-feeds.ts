/**
 * One electron-updater feed per channel for both Mac architectures. Each Mac
 * release leg packages one architecture and names its manifests
 * `<channel>-mac.<arch>.yml`; this writes `<channel>-mac.yml` listing both
 * legs' files, which `MacUpdater` picks between by whether `arm64` is in a
 * file's URL. electron-builder cannot write one manifest from two machines
 * (electron-userland/electron-builder#5592).
 *
 *   node merge-mac-feeds.ts <dir>
 *
 * Rewrites `<dir>` in place: the merged feeds go in, the per-arch ones come
 * out. It also writes `latest-x64-mac.yml`, the x64 leg's own `latest` feed
 * as it was built, which every Intel install from before the shared feed is
 * pinned to. Fails when a channel has one leg's manifest and not the other's,
 * or the legs' versions differ, so the publish job uploads no feed at all.
 *
 * Dependency-free so the publish job runs it with Node alone: it reads YAML
 * through `yq`, which the Ubuntu runner image carries, and writes JSON, which
 * is YAML that every parser reads back with each value's type intact (an
 * unquoted `releaseDate` would come back as a Date).
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type FeedFile = { url: string; [key: string]: unknown };
type Feed = { files: FeedFile[]; version: string; [key: string]: unknown };
type Arch = "arm64" | "x64";

const PER_ARCH = /^(?<channel>.+)-mac\.(?<arch>arm64|x64)\.yml$/;
/** The channel Intel installs from before the shared feed are pinned to. */
const LEGACY_INTEL_FEED = "latest-x64-mac.yml";

/** Whether `MacUpdater.filterFilesForArch` reads a file as the arm64 one. */
const isArm64File = (file: FeedFile) => file.url.includes("arm64");

export function mergeMacFeed(channel: string, arm64: Feed, x64: Feed): Feed {
  if (arm64.version !== x64.version) {
    throw new Error(
      `${channel}: the arm64 leg built ${arm64.version} and the x64 leg ${x64.version}`,
    );
  }
  // An arm64 file without `arm64` in its name would be offered to Intel
  // Macs, and an x64 one with it would be hidden from them.
  if (!arm64.files.some(isArm64File)) {
    throw new Error(`${channel}: no arm64 leg file has "arm64" in its URL`);
  }
  const misnamed = x64.files.find(isArm64File);
  if (misnamed) {
    throw new Error(`${channel}: x64 leg file ${misnamed.url} reads as arm64`);
  }
  const files: FeedFile[] = [];
  for (const file of [...arm64.files, ...x64.files]) {
    if (!files.some((kept) => kept.url === file.url)) files.push(file);
  }
  // The top-level `path`, `sha512` and `releaseDate` stay the arm64 leg's,
  // for an updater old enough to read only those.
  return { ...arm64, files };
}

/**
 * The files to write, by name, for the per-arch manifests in `texts` (file
 * name to text; other names are ignored). Throws when the legs do not pair
 * up.
 */
export function mergeMacFeedFiles(
  texts: Record<string, string>,
  parse: (text: string) => Feed,
): Record<string, string> {
  const legs = new Map<string, Partial<Record<Arch, string>>>();
  for (const [name, text] of Object.entries(texts)) {
    const groups = PER_ARCH.exec(name)?.groups;
    if (!groups?.channel || !groups.arch) continue;
    const arch = groups.arch === "arm64" ? "arm64" : "x64";
    legs.set(groups.channel, {
      ...legs.get(groups.channel),
      [arch]: text,
    });
  }
  if (legs.size === 0) throw new Error("No Mac update manifests found");
  const out: Record<string, string> = {};
  for (const [channel, { arm64, x64 }] of legs) {
    if (arm64 === undefined || x64 === undefined) {
      const missing = arm64 === undefined ? "arm64" : "x64";
      throw new Error(`${channel}: the ${missing} leg wrote no manifest`);
    }
    const merged = mergeMacFeed(channel, parse(arm64), parse(x64));
    out[`${channel}-mac.yml`] = `${JSON.stringify(merged, null, 2)}\n`;
    if (channel === "latest") out[LEGACY_INTEL_FEED] = x64;
  }
  return out;
}

function parseWithYq(text: string): Feed {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- yq's JSON, checked below
  const feed = JSON.parse(
    execFileSync("yq", ["-p=yaml", "-o=json", "-"], {
      encoding: "utf8",
      input: text,
    }),
  ) as Feed;
  if (typeof feed.version !== "string" || !Array.isArray(feed.files)) {
    throw new Error("Not an update manifest");
  }
  return feed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: merge-mac-feeds.ts <dir>");
    process.exit(1);
  }
  const perArch = readdirSync(dir).filter((name) => PER_ARCH.test(name));
  const texts = Object.fromEntries(
    perArch.map((name) => [name, readFileSync(path.join(dir, name), "utf8")]),
  );
  const out = mergeMacFeedFiles(texts, parseWithYq);
  for (const [name, text] of Object.entries(out)) {
    writeFileSync(path.join(dir, name), text);
    console.log(`Wrote ${name}`);
  }
  for (const name of perArch) rmSync(path.join(dir, name));
}
