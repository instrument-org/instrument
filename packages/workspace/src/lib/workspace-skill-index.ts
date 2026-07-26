import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { pathIsWithin } from "./path-is-within";
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
}

/** Per-turn writes keyed by task and session. */
const TURNS = new Map<string, TurnTracker>();
const TURN_CONTEXT = new AsyncLocalStorage<TurnKey>();

interface TurnKey {
  id: TaskId;
  sessionId: StoreId.Session;
}

/** Snapshots the skills directory as a turn's "before" state. */
export async function beginSkillChangeTracking(turn: TurnKey): Promise<void> {
  const key = turnKey(turn);
  const tracker: TurnTracker = {
    before: readWorkspaceSkillIndex(),
    touched: new Set(),
    touchedAll: false,
  };
  TURNS.set(key, tracker);
  try {
    await tracker.before;
  } catch (error) {
    if (TURNS.get(key) === tracker) {
      TURNS.delete(key);
    }
    throw error;
  }
}

/**
 * Classifies only the packages this session mutated, then drops its tracker.
 * Safe to call unconditionally; reports nothing when the turn was not tracked.
 */
export async function consumeSkillChanges(
  turn: TurnKey,
): Promise<WorkspaceSkillChanges> {
  const key = turnKey(turn);
  const tracker = TURNS.get(key);
  TURNS.delete(key);
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
    const existedBefore = before.has(name);
    const existsAfter = after.has(name);
    if (!existedBefore && existsAfter) {
      changes.created.push(name);
    } else if (existedBefore && existsAfter) {
      changes.updated.push(name);
    } else if (existedBefore) {
      changes.removed.push(name);
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
  const turn = TURN_CONTEXT.getStore();
  if (!turn) {
    return;
  }
  const tracker = TURNS.get(turnKey(turn));
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
  if (!TURN_CONTEXT.getStore()) {
    return;
  }
  const skillsDir = getWorkspaceSkillsDir();
  if (!pathIsWithin(filePath, skillsDir)) {
    return;
  }
  const relative = path.relative(skillsDir, filePath);
  recordWorkspaceSkillMutation(relative || "/");
}

/** Runs one tool call with its mutation records bound to the owning session. */
export function withWorkspaceSkillTracking<T>(
  turn: TurnKey,
  callback: () => T,
): T {
  return TURN_CONTEXT.run(turn, callback);
}

function emptyChanges(): WorkspaceSkillChanges {
  return { created: [], removed: [], updated: [] };
}

function turnKey({ id, sessionId }: TurnKey): string {
  return `${id}:${sessionId}`;
}
