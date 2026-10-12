import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getWorkspaceConfig } from "../workspace-config";

/**
 * What the Finder knows about one entry of a folder beyond what `stat` says.
 * Only an entry with something to say is named at all.
 */
export const FinderEntrySchema = z.object({
  /** A Finder alias, which is a file pointing elsewhere; a symbolic link is not one. */
  alias: z.literal(true).optional(),
  /** Hidden by the system, by a leading dot or by the flag `~/Library` carries. */
  hidden: z.literal(true).optional(),
  /** Whether the Finder leaves the extension off the name it shows. */
  hidesExtension: z.literal(true).optional(),
  /** A package's kind as the Finder writes it: "Application", "Photos Library". */
  kind: z.string().optional(),
  name: z.string(),
  /** A folder the Finder shows and opens as one item: an app, a Photos library. */
  package: z.literal(true).optional(),
});
export type FinderEntry = z.output<typeof FinderEntrySchema>;

/**
 * The Finder's answers for a folder's entries, by name. Empty off macOS, in a
 * build without the Mac module, and when the module could not read the
 * folder: the listing then shows what `stat` says, as it does everywhere else.
 *
 * Keyed by the name's composed form, since a name on disk may be stored
 * decomposed and the two halves of the bridge need not agree on which.
 */
export async function finderEntriesOf(
  folder: string,
): Promise<ReadonlyMap<string, FinderEntry>> {
  const ask = getWorkspaceConfig().finderEntries;
  if (!ask) {
    return new Map();
  }
  const entries = await ask(folder).catch(() => []);
  return new Map(entries.map((entry) => [entry.name.normalize("NFC"), entry]));
}

/** How a Finder alias file begins: it is a bookmark, written whole. */
const ALIAS_MAGIC = "book";
/** An alias is a bookmark of a kilobyte or so; nothing larger is read to check. */
const ALIAS_MAX_BYTES = 64 * 1024;

/** Whether a file of this size could be an alias, by its first bytes. */
async function mayBeAlias(hostPath: string, size: number): Promise<boolean> {
  if (size > ALIAS_MAX_BYTES || size < ALIAS_MAGIC.length) {
    return false;
  }
  const file = await fs.open(hostPath, "r").catch(() => null);
  if (!file) {
    return false;
  }
  try {
    const head = Buffer.alloc(ALIAS_MAGIC.length);
    await file.read(head, 0, head.length, 0);
    return head.toString("latin1") === ALIAS_MAGIC;
  } finally {
    await file.close();
  }
}

/** Where an alias leads; undefined for a path that is not one. */
type ResolveAlias = (hostPath: string) => Promise<string | undefined>;

/** Where an alias at this path leads, or nothing for one that is not an alias. */
async function aliasTarget(
  hostPath: string,
  size: number,
  resolve: ResolveAlias,
): Promise<string | undefined> {
  if (!(await mayBeAlias(hostPath, size))) {
    return undefined;
  }
  return resolve(hostPath).catch(() => undefined);
}

/**
 * A host path with every Finder alias on it followed, the way a symbolic
 * link is: an alias to a folder is gone into, and a path that runs on
 * through one (`Desktop/Projects alias/notes.md`, as the columns view builds
 * them) reads what is under its target. A path that is not an alias and
 * runs through none comes back as it is, after one `stat`. Without
 * `resolve` (off macOS, a build without the Mac module) nothing is followed.
 */
export async function resolveThroughAliases(
  hostPath: string,
  resolve: ResolveAlias | undefined,
): Promise<string> {
  if (!resolve) {
    return hostPath;
  }
  const stats = await fs.stat(hostPath).catch(() => null);
  if (stats?.isDirectory()) {
    return hostPath;
  }
  if (stats?.isFile()) {
    return (await aliasTarget(hostPath, stats.size, resolve)) ?? hostPath;
  }
  // Nothing at the path as written, which is what one through an alias to a
  // folder looks like: walk it from the top, following each alias met.
  const { root } = path.parse(hostPath);
  let walked = root;
  for (const segment of path.relative(root, hostPath).split(path.sep)) {
    const next = path.join(walked, segment);
    const at = await fs.stat(next).catch(() => null);
    if (!at) {
      return hostPath;
    }
    walked =
      (at.isFile() && (await aliasTarget(next, at.size, resolve))) || next;
  }
  return walked;
}
