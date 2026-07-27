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
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

export interface WorkspaceSkillChanges {
  created: string[];
  removed: string[];
  updated: string[];
}

/**
 * Skill directory name -> the stamp of its SKILL.md, for the workspace skills
 * directory only.
 *
 * That directory is the whole of what an agent can install or revise (the
 * writable `/skills` mount), so a change here is the complete answer to "did
 * this turn touch a skill" -- every other source is read-only to the agent.
 */
export type WorkspaceSkillIndex = Map<string, SkillStamp>;

interface SkillStamp {
  mtimeMs: number;
  size: number;
}

interface TurnTracker {
  before: Promise<WorkspaceSkillIndex>;
  touched: Set<string>;
  touchedAll: boolean;
  turnId: TurnId;
}

/**
 * Per-turn writes keyed by task and session. Keying by session rather than by
 * turn id keeps a turn that never reached `consumeSkillChanges` from
 * accumulating: the next turn on that session replaces it. The turn id on the
 * tracker is what makes an arriving write prove which turn it came from.
 */
const TURNS = new Map<string, TurnTracker>();

/** Snapshots the skills directory as a turn's "before" state. */
export async function beginSkillChangeTracking(turn: TurnKey): Promise<void> {
  const key = turnKey(turn);
  const tracker: TurnTracker = {
    before: readWorkspaceSkillIndex(),
    touched: new Set(),
    touchedAll: false,
    turnId: beginTurn(turn),
  };
  TURNS.set(key, tracker);
  try {
    await tracker.before;
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
 * SKILL.md to separate them from the rest of the directory.
 */
export async function consumeSkillChanges(
  turn: TurnKey,
): Promise<WorkspaceSkillChanges> {
  const key = turnKey(turn);
  const tracker = TURNS.get(key);
  TURNS.delete(key);
  endTurn(turn);
  if (!tracker) {
    return emptyChanges();
  }
  const before = await tracker.before;
  const after = await readWorkspaceSkillIndex();
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

/**
 * One shallow read of the skills directory plus a stat per entry, used to
 * classify a session-owned mutation as a creation, update, or removal.
 */
export async function readWorkspaceSkillIndex(): Promise<WorkspaceSkillIndex> {
  const skillsDir = getWorkspaceSkillsDir();
  const index: WorkspaceSkillIndex = new Map();

  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    // A workspace with no skills yet has no directory; it is created lazily
    // when the bash filesystem mounts.
    return index;
  }

  await Promise.all(
    entries.map(async (entry) => {
      // Directory symlinks are how a skill gets shared between checkouts, so
      // follow rather than filter: `stat` on the SKILL.md answers both whether
      // the entry is a skill and whether it changed.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        return;
      }
      const stats = await fs
        .stat(path.join(skillsDir, entry.name, "SKILL.md"))
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
 * Records one successful mutation routed through this session's writable
 * skills mount. `mountPath` is relative to that mount, as just-bash sees it.
 */
export function recordWorkspaceSkillMutation(mountPath: string): void {
  const tracker = trackerForCurrentTurn();
  if (!tracker) {
    return;
  }
  const normalized = mountPath.replaceAll("\\", "/");
  const relative = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;
  const name = relative.split("/")[0];
  if (!name || name === ".") {
    tracker.touchedAll = true;
    return;
  }
  tracker.touched.add(name);
}

/** Records a host write when it lands inside the workspace skills directory. */
export function recordWorkspaceSkillWrite(filePath: string): void {
  if (!getTurnContext()) {
    return;
  }
  const skillsDir = getWorkspaceSkillsDir();
  if (!pathIsWithin(filePath, skillsDir)) {
    return;
  }
  const relative = path.relative(skillsDir, filePath);
  recordWorkspaceSkillMutation(relative || "/");
}

function emptyChanges(): WorkspaceSkillChanges {
  return { created: [], removed: [], updated: [] };
}

function stampChanged(before: SkillStamp, after: SkillStamp): boolean {
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
