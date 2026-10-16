import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { logger } from "@/electron-main/lib/electron-logger";
import { getMachineState } from "@/electron-main/stores/machine/state";
import {
  type KeyFolderName,
  KEY_FOLDER_NAMES,
} from "@instrument-org/workspace/electron";

/**
 * Which of the six folders a person opens have gone from a workspace's top
 * level, and the watch that notices one going.
 *
 * Only a folder this computer has made is looked for. A fresh workspace has
 * no `Topics/` until the person makes a topic, and a workspace that never had
 * one is not missing it; what is recorded is what we made, so what is missing
 * is a folder that was there and is not.
 *
 * Nothing is restored or recreated here. The notice informs, the person
 * dismisses it, and the next thing the app writes under that name makes the
 * folder again, which is when the notice goes on its own.
 */

/** A folder we have made at a workspace's top level, as the record keeps it. */
export type MadeFolders = Record<string, KeyFolderName[]>;

/**
 * Records that these folders exist at `root` because we made them, so a later
 * launch can tell one the person deleted from one that was never there.
 *
 * Idempotent and additive: a name already recorded stays, and a name that is
 * not one of the six is ignored rather than stored.
 */
export function recordKeyFolders(root: string, names: readonly string[]): void {
  const made = getMachineState().get("madeFolders") ?? {};
  const kept = new Set(made[root] ?? []);
  for (const name of names) {
    if (isKeyFolderName(name)) {
      kept.add(name);
    }
  }
  const ordered = KEY_FOLDER_NAMES.filter((name) => kept.has(name));
  if (sameNames(ordered, made[root] ?? [])) {
    return;
  }
  getMachineState().set("madeFolders", { ...made, [root]: ordered });
}

/**
 * The folders recorded at `root` that are not there now, in the order they
 * are listed to a reader.
 *
 * A name taken by a file rather than a folder counts as missing: the person
 * replaced it, and nothing the app writes under it will work either.
 */
export async function missingKeyFolders(
  root: string,
): Promise<KeyFolderName[]> {
  const made = getMachineState().get("madeFolders")?.[root] ?? [];
  const checked = await Promise.all(
    made.map(async (name) => {
      const stats = await fsp
        .stat(path.join(root, name))
        .catch(() => undefined);
      return stats?.isDirectory() === true ? undefined : name;
    }),
  );
  return checked.filter((name): name is KeyFolderName => name !== undefined);
}

/**
 * Watches `root` itself, not what is under it, and calls `onChange` with the
 * folders now missing whenever its listing changes.
 *
 * One watch per workspace, on one directory, so a workspace of a hundred
 * thousand files costs one handle. Several events arrive for one gesture in a
 * file manager, so they are collected before the check runs.
 *
 * The watch is best effort: a platform or a network volume that refuses to
 * watch leaves the launch check as the only one, which is the behavior a
 * person sees as the notice appearing when they next open the app.
 */
export function watchKeyFolders(
  root: string,
  onChange: (missing: KeyFolderName[]) => void,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const check = () => {
    timer = undefined;
    void missingKeyFolders(root).then(
      (missing) => {
        if (!stopped) {
          onChange(missing);
        }
      },
      (error: unknown) => {
        logger.error("Failed to check the workspace's folders", error);
      },
    );
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(root, { recursive: false }, () => {
      if (timer === undefined) {
        timer = setTimeout(check, SETTLE_MS);
      }
    });
    watcher.on("error", (error) => {
      logger.error("The watch on the workspace's folders ended", error);
    });
  } catch (error) {
    logger.error("Could not watch the workspace's folders", error);
  }

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    watcher?.close();
  };
}

/** How long a burst of events is collected for before the folders are checked. */
const SETTLE_MS = 300;

function isKeyFolderName(name: string): name is KeyFolderName {
  return KEY_FOLDER_NAMES.some((known) => known === name);
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}
