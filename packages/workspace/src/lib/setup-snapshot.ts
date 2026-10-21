import fs from "node:fs/promises";
import path from "node:path";

import { SETUP_KINDS, type SetupKind, type SetupTouch } from "./setup-changes";
import { filesUnder, fingerprintOf } from "./folder-fingerprint";

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
  /** What the item's files hold (`folder-fingerprint.ts`). */
  fingerprint: string;
  kind: SetupKind;
  name: string;
  present: boolean;
}

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
        const files = await filesUnder(path.join(dir, entry.name));
        add({
          fingerprint: fingerprintOf(files),
          kind,
          name: entry.name,
          present: files.some((file) => file.path === marker),
        });
      }
    }),
    (async () => {
      for (const file of await filesUnder(SETUP_KINDS.memory.folder(), {
        depth: 0,
      })) {
        const name = SETUP_KINDS.memory.itemOf(file.path);
        if (name !== undefined) {
          add({
            fingerprint: file.content,
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
