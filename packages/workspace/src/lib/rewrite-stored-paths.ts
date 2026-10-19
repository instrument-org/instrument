import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import {
  type DraftOnDisk,
  readDrafts,
  writeDraftFile,
} from "./drafts/draft-folder";
import { hostPathWithin } from "./host-path";
import { readJsonRecordSync, updateJsonRecordSync } from "./json-record-file";

/**
 * One move a migration made on this computer: what was under `from` and is
 * not there now is under `to`, at the same place below it. A folder whose
 * entries went to several places is one move per place.
 */
export interface PathMove {
  from: string;
  to: string;
}

/**
 * A rewrite the caller brings, for a path the app keeps somewhere this does
 * not open: where the person left off in a window, and the files they opened
 * lately. Handed the moves and where a path is after them, it answers what it
 * did in the same words as the rest, and reports rather than throws.
 */
export type StoredPathRewrite = (moved: {
  moves: readonly PathMove[];
  where: (hostPath: string) => string;
}) => string[];

/**
 * How many moves one path is followed through: a folder moved twice (a
 * chat's work out of the workspace, then the workspace itself) is found in
 * two steps, and a recorded loop stops here.
 */
const MAX_MOVES_FOLLOWED = 4;

/**
 * Where a folder the app stored the path of has gone, written into the
 * files holding those paths, once, by the migration that moved it. Called
 * after the move rather than before, so only a move that happened is
 * written, and a path whose entry was left behind keeps the place it has.
 *
 * What the app stores the path of, all of it on this computer:
 *
 * - Settings › Permissions: the folder rules the person added, the folders
 *   and files opened to one chat, the folders they said not now to, and the
 *   folders granted under each topic.
 * - A file or folder attached to a draft, in its `DRAFT.md`.
 * - Whatever the caller brings in `also`, for what it keeps in a store this
 *   does not open: the Files tabs a window is left on, and the person's
 *   recent files.
 *
 * Safe to run again, and safe to run with moves an earlier launch already
 * wrote: a path is rewritten only when what it names is gone and the place
 * a move leads to is there, so a path already rewritten is left alone. A
 * file that cannot be read is left as it is for the next launch; nothing
 * here throws.
 */
export function rewriteStoredPaths({
  also = [],
  machineDir,
  moves,
  rootDir,
}: {
  also?: readonly StoredPathRewrite[];
  machineDir: string;
  moves: readonly PathMove[];
  rootDir: string;
}): string[] {
  const done: string[] = [];
  if (moves.length === 0) {
    return done;
  }
  const where = (hostPath: string) => movedTo(hostPath, moves);
  rewritePermissions({ done, machineDir, where });
  for (const entry of readDrafts(rootDir)) {
    rewriteDraftAttachments({ done, entry, where });
  }
  for (const rewrite of also) {
    try {
      done.push(...rewrite({ moves, where }));
    } catch (error) {
      done.push(`left one of the app's own stores as it is (${String(error)})`);
    }
  }
  return done;
}

/**
 * Takes in the record of moves an earlier build kept, `moved-paths.json`,
 * which every read of a stored path went through: the paths it holds are
 * written where they went, once, and the file goes.
 *
 * Runs at launch once the workspace is in the shape this build reads, since
 * the files being rewritten are in their final places by then. A boot that
 * finds no record does nothing.
 */
export function settleMovedPaths({
  also,
  machineDir,
  rootDir,
}: {
  also?: readonly StoredPathRewrite[];
  machineDir: string;
  rootDir: string;
}): string[] {
  const file = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.movedPaths);
  const read = readJsonRecordSync(file);
  if (read.kind !== "read") {
    // Missing, or a file this cannot read: either way nothing can be
    // followed through it, and a record nothing reads does not stay.
    fs.rmSync(file, { force: true });
    return [];
  }
  const moves = Array.isArray(read.record.moves)
    ? read.record.moves.flatMap((move: unknown) =>
        isRecord(move) &&
        typeof move.from === "string" &&
        typeof move.to === "string"
          ? [{ from: move.from, to: move.to }]
          : [],
      )
    : [];
  const done = rewriteStoredPaths({ also, machineDir, moves, rootDir });
  fs.rmSync(file, { force: true });
  return [...done, `took in and removed ${file}`];
}

/** Settings › Permissions, every path it holds where that path is now. */
function rewritePermissions({
  done,
  machineDir,
  where,
}: {
  done: string[];
  machineDir: string;
  where: (hostPath: string) => string;
}) {
  const file = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.permissions);
  if (readJsonRecordSync(file).kind !== "read") {
    return;
  }
  let rewritten = 0;
  const movedPath = (held: unknown, key: string): unknown => {
    if (!isRecord(held) || typeof held[key] !== "string") {
      return held;
    }
    const to = where(held[key]);
    if (to === held[key]) {
      return held;
    }
    rewritten += 1;
    return { ...held, [key]: to };
  };
  /** One chat's grants and the folders it said no to, where those are now. */
  const movedChat = (chat: unknown): unknown => {
    if (!isRecord(chat)) {
      return chat;
    }
    return {
      ...chat,
      ...(Array.isArray(chat.denials)
        ? {
            denials: chat.denials.map((denial: unknown) =>
              isRecord(denial) && denial.kind === "folder"
                ? movedPath(denial, "target")
                : denial,
            ),
          }
        : {}),
      ...(Array.isArray(chat.grants)
        ? {
            grants: chat.grants.map((grant: unknown) =>
              movedPath(grant, "path"),
            ),
          }
        : {}),
    };
  };
  /** One topic's granted folders, where those are now. */
  const movedTopic = (topic: unknown): unknown =>
    isRecord(topic) && Array.isArray(topic.folders)
      ? {
          ...topic,
          folders: topic.folders.map((folder: unknown) =>
            movedPath(folder, "path"),
          ),
        }
      : topic;
  try {
    updateJsonRecordSync(file, (held) => {
      const next = {
        ...(Array.isArray(held.folders)
          ? {
              folders: held.folders.map((rule: unknown) =>
                movedPath(rule, "path"),
              ),
            }
          : {}),
        ...(isRecord(held.chats)
          ? {
              chats: Object.fromEntries(
                Object.entries(held.chats).map(([chatId, chat]) => [
                  chatId,
                  movedChat(chat),
                ]),
              ),
            }
          : {}),
        ...(isRecord(held.topics)
          ? {
              topics: Object.fromEntries(
                Object.entries(held.topics).map(([topicId, topic]) => [
                  topicId,
                  movedTopic(topic),
                ]),
              ),
            }
          : {}),
      };
      return rewritten > 0 ? next : undefined;
    });
  } catch (error) {
    done.push(`left ${file} as it is (${String(error)})`);
    return;
  }
  if (rewritten > 0) {
    done.push(
      `wrote ${rewritten.toString()} path(s) where they went in ${file}`,
    );
  }
}

/**
 * One draft's attached files and folders where those are now, so a draft
 * carrying a file from the workspace's own folder still sends that file after
 * the folder moves. The front matter the build does not write is kept, and
 * `updated` stays as the file had it, so the rewrite does not move a draft to
 * the front of its chat's box.
 */
function rewriteDraftAttachments({
  done,
  entry,
  where,
}: {
  done: string[];
  entry: DraftOnDisk;
  where: (hostPath: string) => string;
}) {
  const attached = entry.draft.attached;
  if (!attached) {
    return;
  }
  // Only an absolute path names something outside the draft: what was pasted
  // in is beside the draft, named relative to its folder, and travels with it.
  const moved = attached.map((item) =>
    path.isAbsolute(item.path) ? { ...item, path: where(item.path) } : item,
  );
  const rewritten = moved.filter(
    (item, index) => item.path !== attached[index]?.path,
  ).length;
  if (rewritten === 0) {
    return;
  }
  try {
    writeDraftFile(entry.file, { ...entry.draft, attached: moved });
  } catch (error) {
    done.push(`left ${entry.file} as it is (${String(error)})`);
    return;
  }
  done.push(
    `wrote ${rewritten.toString()} path(s) where they went in ${entry.file}`,
  );
}

/**
 * Where a path is after `moves`: the path itself when what it names is
 * there or no move holds it, and otherwise the first place a move holding
 * it leads to that is there, the deepest move tried first. When none leads
 * anywhere, the deepest one's answer stands, so a move whose target is not
 * made yet still carries the path.
 */
function movedTo(hostPath: string, moves: readonly PathMove[]): string {
  return follow(hostPath, moves, MAX_MOVES_FOLLOWED).path;
}

function follow(
  hostPath: string,
  moves: readonly PathMove[],
  budget: number,
): { found: boolean; path: string } {
  if (fs.existsSync(hostPath)) {
    return { found: true, path: hostPath };
  }
  if (budget === 0) {
    return { found: false, path: hostPath };
  }
  let fallback: { found: boolean; path: string } | undefined;
  for (const move of movesHolding(hostPath, moves)) {
    const next = follow(path.join(move.to, move.relative), moves, budget - 1);
    if (next.found) {
      return next;
    }
    fallback ??= next;
  }
  return fallback ?? { found: false, path: hostPath };
}

/** Every move holding a path, the deepest first. */
function movesHolding(
  hostPath: string,
  moves: readonly PathMove[],
): (PathMove & { relative: string })[] {
  return moves
    .flatMap((move) => {
      const relative = hostPathWithin(move.from, hostPath);
      return relative === null
        ? []
        : [{ ...move, relative: relative === "/" ? "." : `.${relative}` }];
    })
    .toSorted((a, b) => b.from.length - a.from.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
