import fs from "node:fs/promises";
import path from "node:path";

import { pathIsWithin } from "./path-is-within";
import {
  beginTurn,
  endTurn,
  getTurnContext,
  type TurnId,
  type TurnKey,
  turnKey,
} from "./turn-context";
import {
  WORKSPACE_MOUNT_KINDS,
  WORKSPACE_MOUNTS,
  type WorkspaceMountKind,
} from "./workspace-mounts";

/** What one turn did to the packages in one writable workspace mount. */
export interface WorkspaceMountChanges {
  created: string[];
  removed: string[];
  updated: string[];
}

/**
 * Package directory name -> the stamp of its entry file, for one writable
 * workspace mount.
 *
 * That mount is the whole of what an agent can install or revise for its kind,
 * so a change here is the complete answer to "did this turn touch a skill / a
 * connector" -- every other source is read-only to the agent.
 */
export type WorkspaceMountIndex = Map<string, PackageStamp>;

interface MountTracker {
  before: Promise<WorkspaceMountIndex>;
  touched: Set<string>;
  touchedAll: boolean;
}

interface PackageStamp {
  mtimeMs: number;
  size: number;
}

interface TurnTracker {
  mounts: Record<WorkspaceMountKind, MountTracker>;
  turnId: TurnId;
}

/**
 * Per-turn writes keyed by task and session. Keying by session rather than by
 * turn id keeps a turn that never reached `consumeMountChanges` from
 * accumulating: the next turn on that session replaces it. The turn id on the
 * tracker is what makes an arriving write prove which turn it came from.
 */
const TURNS = new Map<string, TurnTracker>();

/** Snapshots every writable workspace mount as a turn's "before" state. */
export async function beginMountChangeTracking(turn: TurnKey): Promise<void> {
  const key = turnKey(turn);
  const tracker: TurnTracker = {
    mounts: mountTrackers(),
    turnId: beginTurn(turn),
  };
  TURNS.set(key, tracker);
  try {
    await Promise.all(
      WORKSPACE_MOUNT_KINDS.map((kind) => tracker.mounts[kind].before),
    );
  } catch (error) {
    if (TURNS.get(key) === tracker) {
      TURNS.delete(key);
      endTurn(turn);
    }
    throw error;
  }
}

/**
 * Classifies only the packages this session mutated, then drops its tracker.
 * Safe to call unconditionally; reports nothing when the turn was not tracked.
 *
 * A package the turn named counts as updated on the write alone: editing
 * `scripts/run.ts` is a real revision that leaves SKILL.md untouched. The
 * `touchedAll` fallback -- a mutation aimed at the mount root, which names no
 * package -- has no such evidence, so the packages it sweeps in need a changed
 * entry file to separate them from the rest of the directory.
 */
export async function consumeMountChanges(
  turn: TurnKey,
): Promise<Record<WorkspaceMountKind, WorkspaceMountChanges>> {
  const key = turnKey(turn);
  const tracker = TURNS.get(key);
  TURNS.delete(key);
  endTurn(turn);
  if (!tracker) {
    return emptyChangesByKind();
  }

  const changes = emptyChangesByKind();
  await Promise.all(
    WORKSPACE_MOUNT_KINDS.map(async (kind) => {
      changes[kind] = await classifyMount(kind, tracker.mounts[kind]);
    }),
  );
  return changes;
}

/**
 * One shallow read of a mount's directory plus a stat per entry, used to
 * classify a session-owned mutation as a creation, update, or removal.
 */
export async function readWorkspaceMountIndex(
  kind: WorkspaceMountKind,
): Promise<WorkspaceMountIndex> {
  const { entryFile, resolveHostRoot } = WORKSPACE_MOUNTS[kind];
  const hostRoot = resolveHostRoot();
  const index: WorkspaceMountIndex = new Map();

  let entries;
  try {
    entries = await fs.readdir(hostRoot, { withFileTypes: true });
  } catch {
    // A workspace with nothing of this kind yet has no directory; it is created
    // lazily when the bash filesystem mounts.
    return index;
  }

  await Promise.all(
    entries.map(async (entry) => {
      // Directory symlinks are how a package gets shared between checkouts, so
      // follow rather than filter: `stat` on the entry file answers both whether
      // the directory is a package and whether it changed.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        return;
      }
      const stats = await fs
        .stat(path.join(hostRoot, entry.name, entryFile))
        .catch(() => null);
      if (!stats?.isFile()) {
        return;
      }
      index.set(entry.name, { mtimeMs: stats.mtimeMs, size: stats.size });
    }),
  );

  return index;
}

/**
 * Records one successful mutation routed through this session's writable mount.
 * `mountPath` is relative to that mount, as just-bash sees it.
 */
export function recordWorkspaceMountMutation(
  kind: WorkspaceMountKind,
  mountPath: string,
): void {
  const tracker = trackerForCurrentTurn();
  if (!tracker) {
    return;
  }
  const normalized = mountPath.replaceAll("\\", "/");
  const relative = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;
  const name = relative.split("/")[0];
  const mount = tracker.mounts[kind];
  if (!name || name === ".") {
    mount.touchedAll = true;
    return;
  }
  mount.touched.add(name);
}

/**
 * Records a host write when it lands inside one of the writable workspace
 * mounts. The dedicated file tools write through real fs rather than the
 * mounted filesystem, so this is how their writes get attributed.
 */
export function recordWorkspaceMountWrite(filePath: string): void {
  if (!getTurnContext()) {
    return;
  }
  for (const kind of WORKSPACE_MOUNT_KINDS) {
    const hostRoot = WORKSPACE_MOUNTS[kind].resolveHostRoot();
    if (!pathIsWithin(filePath, hostRoot)) {
      continue;
    }
    const relative = path.relative(hostRoot, filePath);
    recordWorkspaceMountMutation(kind, relative || "/");
    return;
  }
}

async function classifyMount(
  kind: WorkspaceMountKind,
  tracker: MountTracker,
): Promise<WorkspaceMountChanges> {
  const before = await tracker.before;
  const after = await readWorkspaceMountIndex(kind);
  const names = tracker.touchedAll
    ? new Set([...after.keys(), ...before.keys()])
    : tracker.touched;
  const changes = emptyChanges();
  for (const name of names) {
    const stampBefore = before.get(name);
    const stampAfter = after.get(name);
    if (!stampBefore && stampAfter) {
      changes.created.push(name);
    } else if (stampBefore && !stampAfter) {
      changes.removed.push(name);
    } else if (
      stampBefore &&
      stampAfter &&
      (tracker.touched.has(name) || stampChanged(stampBefore, stampAfter))
    ) {
      changes.updated.push(name);
    }
  }
  changes.created.sort();
  changes.removed.sort();
  changes.updated.sort();
  return changes;
}

function emptyChanges(): WorkspaceMountChanges {
  return { created: [], removed: [], updated: [] };
}

function emptyChangesByKind(): Record<
  WorkspaceMountKind,
  WorkspaceMountChanges
> {
  return { connectors: emptyChanges(), skills: emptyChanges() };
}

function mountTrackers(): Record<WorkspaceMountKind, MountTracker> {
  return {
    connectors: newMountTracker("connectors"),
    skills: newMountTracker("skills"),
  };
}

function newMountTracker(kind: WorkspaceMountKind): MountTracker {
  return {
    before: readWorkspaceMountIndex(kind),
    touched: new Set(),
    touchedAll: false,
  };
}

function stampChanged(before: PackageStamp, after: PackageStamp): boolean {
  return before.mtimeMs !== after.mtimeMs || before.size !== after.size;
}

/**
 * The tracker a write should land in, or undefined when the write has no owner.
 *
 * A continuation started during an earlier turn still carries that turn's
 * context. The tracker under its key belongs to whatever turn is running now,
 * so a mismatched turn id means the write arrived too late to be attributed and
 * is dropped rather than billed to a turn that did not make it.
 */
function trackerForCurrentTurn(): TurnTracker | undefined {
  const context = getTurnContext();
  if (!context) {
    return undefined;
  }
  const tracker = TURNS.get(turnKey(context));
  return tracker?.turnId === context.turnId ? tracker : undefined;
}
