import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { SETUP_KINDS, type SetupKind, type SetupTouch } from "./setup-changes";
import { SKILL_ARTIFACT_IGNORE } from "./skill-artifact-ignore";

/**
 * What each item of the person's setup is right now: whether it is there (its
 * `SKILL.md`, `APP.md`, `TOPIC.md` or memory file exists) and a fingerprint of
 * the files it holds. Keyed `kind:name`.
 *
 * Read from the disk rather than from anyone's account of a write, so it sees
 * what any program changed. It is cheap because these folders are small once
 * what a build or an install leaves in them is skipped: a `node_modules` in a
 * skill is thousands of files nobody wrote, and none of them is a change to
 * the skill worth telling anyone about.
 */
export type SetupSnapshot = Map<string, SetupItem>;

interface SetupItem {
  /** Sizes and modification times of the item's files, hashed. */
  fingerprint: string;
  kind: SetupKind;
  name: string;
  present: boolean;
}

/** Files read for one item before it is fingerprinted by its marker alone. */
const FILES_PER_ITEM = 2000;

/** Folders inside an item that are never its own content. */
const SKIPPED = new Set([...SKILL_ARTIFACT_IGNORE, ".git"]);

export async function snapshotSetup(): Promise<SetupSnapshot> {
  const snapshot: SetupSnapshot = new Map();
  const add = (item: SetupItem) => {
    snapshot.set(`${item.kind}:${item.name}`, item);
  };
  await Promise.all([
    ...(["app", "skill", "topic"] as const).map(async (kind) => {
      const dir = SETUP_KINDS[kind].folder();
      // The marker's place inside an item's folder.
      const marker = SETUP_KINDS[kind].marker("").slice(1);
      for (const entry of await entriesOf(dir)) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const itemDir = path.join(dir, entry.name);
        const files = await filesIn(itemDir);
        add({
          fingerprint: fingerprintOf(files),
          kind,
          name: entry.name,
          present: files.some((file) => file.path === marker),
        });
      }
    }),
    (async () => {
      const dir = SETUP_KINDS.memory.folder();
      for (const entry of await entriesOf(dir)) {
        const name = SETUP_KINDS.memory.itemOf(entry.name);
        if (!entry.isFile() || name === undefined) {
          continue;
        }
        const stats = await fs.stat(path.join(dir, entry.name)).catch(() => {});
        if (stats) {
          add({
            fingerprint: `${stats.size}:${stats.mtimeMs}`,
            kind: "memory",
            name,
            present: true,
          });
        }
      }
    })(),
  ]);
  return snapshot;
}

/**
 * The items that differ between two snapshots, as touches: each with whether
 * it was there in the first. An item that was in neither is no change.
 */
export function setupTouchesBetween(
  before: SetupSnapshot,
  after: SetupSnapshot,
): SetupTouch[] {
  const touches: SetupTouch[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key);
    const now = after.get(key);
    const item = now ?? was;
    if (!item || (!was?.present && !now?.present)) {
      continue;
    }
    if (
      was?.present !== now?.present ||
      was?.fingerprint !== now?.fingerprint
    ) {
      touches.push({
        existedBefore: was?.present ?? false,
        kind: item.kind,
        name: item.name,
      });
    }
  }
  return touches;
}

async function entriesOf(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // A workspace with none of these yet has no folder.
    return [];
  }
}

interface FileStamp {
  /** Relative to the item, with `/`. */
  path: string;
  stamp: string;
}

/**
 * The item's own files, skipping what an install or a build left. Past
 * `FILES_PER_ITEM` it stops reading, which leaves the marker (read first) and
 * what was reached so far: an item that large still reports a change to its
 * instructions, and never makes a command slow.
 */
async function filesIn(itemDir: string): Promise<FileStamp[]> {
  const files: FileStamp[] = [];
  const queue = [""];
  while (queue.length > 0 && files.length < FILES_PER_ITEM) {
    const relative = queue.shift() ?? "";
    const entries = await entriesOf(path.join(itemDir, relative));
    const room = FILES_PER_ITEM - files.length;
    const ownFiles = entries.filter((entry) => !entry.isDirectory());
    // Every file of a folder before any folder below it, so a capped item
    // still fingerprints its top level, where the marker is.
    const stamped = await Promise.all(
      ownFiles.slice(0, room).map(async (entry) => {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        const stats = await fs
          .lstat(path.join(itemDir, child))
          .catch(() => undefined);
        return (
          stats && { path: child, stamp: `${stats.size}:${stats.mtimeMs}` }
        );
      }),
    );
    for (const file of stamped) {
      if (file) {
        files.push(file);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIPPED.has(entry.name)) {
        queue.push(relative ? `${relative}/${entry.name}` : entry.name);
      }
    }
  }
  return files;
}

function fingerprintOf(files: FileStamp[]): string {
  const hash = createHash("sha1");
  for (const file of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.path}\0${file.stamp}\n`);
  }
  return hash.digest("hex");
}
