import { type IFileSystem } from "just-bash";
import fs from "node:fs/promises";
import path from "node:path";

import { APPS_FOLDER_NAME } from "../constants";
import { APP_FILE_NAME } from "./apps/app-file";
import { memoryDir, readMemory } from "./memory/store";
import {
  beginTurn,
  endTurn,
  getTurnContext,
  type TurnId,
  type TurnKey,
  turnKey,
} from "./turn-context";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * The parts of a person's setup a turn can change that outlast the chat: a
 * skill (a folder in `Skills/`), an app (a folder in `Apps/`), a memory (a
 * file in `Memory/`). Each is named the way its folder or file is.
 */
type SetupKind = "app" | "memory" | "skill";

/** One item of the setup this turn wrote to, and whether it was there first. */
export interface SetupTouch {
  existedBefore: boolean;
  kind: SetupKind;
  name: string;
}

export interface SetupChange {
  change: "added" | "changed" | "removed";
  kind: SetupKind;
  name: string;
}

interface TurnTracker {
  /** By `kind:name`; the first touch says whether the item was there before. */
  touched: Map<string, SetupTouch>;
  turnId: TurnId;
}

/**
 * The turns being tracked, by chat and session. Keyed by session rather than
 * turn so a turn that never reached `consumeSetupChanges` is replaced by the
 * next one on its session; the turn id is what proves a write is this turn's.
 */
const TURNS = new Map<string, TurnTracker>();

/**
 * Set in the bash worker, which has no turns of its own: each touch goes to
 * the main thread, where the turn that ran the command records it.
 */
let forwardTouch: ((touch: SetupTouch) => void) | undefined;

export function setSetupTouchForwarder(next: (touch: SetupTouch) => void) {
  forwardTouch = next;
}

export function beginSetupChangeTracking(turn: TurnKey): void {
  TURNS.set(turnKey(turn), { touched: new Map(), turnId: beginTurn(turn) });
}

/**
 * Records that the turn running now wrote to one item of the setup. Only a
 * write the agent's own shell, file tools or commands made reaches here, so
 * whatever is recorded is this turn's doing; a write from anywhere else (the
 * person, another chat, a program run outside the shell's filesystem) is not.
 */
export function recordSetupTouch(touch: SetupTouch): void {
  if (forwardTouch) {
    forwardTouch(touch);
    return;
  }
  const tracker = trackerForCurrentTurn();
  const key = `${touch.kind}:${touch.name}`;
  if (tracker && !tracker.touched.has(key)) {
    tracker.touched.set(key, touch);
  }
}

/**
 * What the turn's writes did, by comparing each item it touched as it is now
 * against whether it was there before its first write. Ends the tracking.
 */
export async function consumeSetupChanges(
  turn: TurnKey,
): Promise<SetupChange[]> {
  const key = turnKey(turn);
  const tracker = TURNS.get(key);
  TURNS.delete(key);
  endTurn(turn);
  if (!tracker) {
    return [];
  }
  const changes = await Promise.all(
    [...tracker.touched.values()].map(async (touch) => {
      const exists = await setupItemExists(touch.kind, touch.name);
      const change: SetupChange["change"] | undefined = touch.existedBefore
        ? exists
          ? "changed"
          : "removed"
        : exists
          ? "added"
          : undefined;
      return change ? [{ change, kind: touch.kind, name: touch.name }] : [];
    }),
  );
  return changes
    .flat()
    .toSorted(
      (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    );
}

/** Whether a skill, app or memory of that name is there now. */
async function setupItemExists(kind: SetupKind, name: string) {
  if (kind === "memory") {
    return (await readMemory(memoryDir(), name)) !== undefined;
  }
  const marker =
    kind === "skill"
      ? path.join(getWorkspaceSkillsDir(), name, "SKILL.md")
      : path.join(
          getWorkspaceConfig().rootDir,
          APPS_FOLDER_NAME,
          name,
          APP_FILE_NAME,
        );
  return fs.stat(marker).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

/**
 * The tracker a write lands in, or none when the write has no owner. A
 * continuation started during an earlier turn still carries that turn's
 * context, and the turn id keeps it off the turn running now.
 */
function trackerForCurrentTurn(): TurnTracker | undefined {
  const context = getTurnContext();
  if (!context) {
    return undefined;
  }
  const tracker = TURNS.get(turnKey(context));
  return tracker?.turnId === context.turnId ? tracker : undefined;
}

/**
 * A setup folder (`Skills/` or `Apps/`) as a mounted filesystem names it,
 * and where an item's marker file sits in it.
 */
export interface SetupFolder {
  kind: "app" | "skill";
  /**
   * The folder as the delegate is handed paths, without a trailing slash:
   * `""` when the mount is the folder itself.
   */
  root: string;
}

/**
 * Records every write a mounted filesystem makes into a setup folder,
 * without changing how it reads or writes. Before each write it checks
 * whether the item written to was there, so what the turn did is read off
 * its own writes rather than off a picture of the whole folder, which would
 * credit the turn with anyone else's changes made meanwhile.
 *
 * A write aimed at the folder itself names no item: removing the folder
 * touches each item in it, and copying or moving something into it touches
 * the item named after what was copied.
 */
export function setupTrackingFs(
  delegate: IFileSystem,
  folders: readonly SetupFolder[],
): IFileSystem {
  const markerOf = (folder: SetupFolder, name: string) =>
    `${folder.root}/${name}/${folder.kind === "skill" ? "SKILL.md" : APP_FILE_NAME}`;

  /** The folder a path is in, and the item it names there ("" for the folder itself). */
  const locate = (given: string) => {
    const target = path.posix.normalize(`/${given}`).replace(/\/+$/, "");
    for (const folder of folders) {
      if (target === folder.root) {
        return { folder, name: "" };
      }
      if (target.startsWith(`${folder.root}/`)) {
        const name = target.slice(folder.root.length + 1).split("/")[0] ?? "";
        return { folder, name };
      }
    }
    return undefined;
  };

  const touchOf = async (
    folder: SetupFolder,
    name: string,
  ): Promise<SetupTouch | undefined> =>
    name === "" || name === "."
      ? undefined
      : {
          existedBefore: await delegate.exists(markerOf(folder, name)),
          kind: folder.kind,
          name,
        };

  /** What a write to `target` touches, read before the write runs. */
  const touchesOf = async (
    target: string,
    { into }: { into?: string } = {},
  ): Promise<SetupTouch[]> => {
    const found = locate(target);
    if (!found) {
      return [];
    }
    if (found.name !== "") {
      const touch = await touchOf(found.folder, found.name);
      return touch ? [touch] : [];
    }
    // Into the folder itself: the item is named after what arrives.
    if (into !== undefined) {
      const touch = await touchOf(found.folder, path.posix.basename(into));
      return touch ? [touch] : [];
    }
    return [];
  };

  const tracked = async <T>(
    targets: { into?: string; path: string }[],
    run: () => Promise<T>,
  ): Promise<T> => {
    const touches = (
      await Promise.all(targets.map((each) => touchesOf(each.path, each)))
    ).flat();
    const result = await run();
    for (const touch of touches) {
      recordSetupTouch(touch);
    }
    return result;
  };

  const readFileBytes = delegate.readFileBytes?.bind(delegate);
  const readdirWithFileTypes = delegate.readdirWithFileTypes?.bind(delegate);
  const createExclusive = delegate.createExclusive?.bind(delegate);
  const wrapped: IFileSystem = {
    appendFile: (...args) =>
      tracked([{ path: args[0] }], () => delegate.appendFile(...args)),
    chmod: (...args) =>
      tracked([{ path: args[0] }], () => delegate.chmod(...args)),
    cp: (...args) =>
      tracked([{ into: args[0], path: args[1] }], () => delegate.cp(...args)),
    exists: (...args) => delegate.exists(...args),
    getAllPaths: () => delegate.getAllPaths(),
    link: (...args) =>
      tracked([{ into: args[0], path: args[1] }], () => delegate.link(...args)),
    lstat: (...args) => delegate.lstat(...args),
    mkdir: (...args) =>
      tracked([{ path: args[0] }], () => delegate.mkdir(...args)),
    mv: (...args) =>
      tracked([{ path: args[0] }, { into: args[0], path: args[1] }], () =>
        delegate.mv(...args),
      ),
    readdir: (...args) => delegate.readdir(...args),
    readFile: (...args) => delegate.readFile(...args),
    readFileBuffer: (...args) => delegate.readFileBuffer(...args),
    readlink: (...args) => delegate.readlink(...args),
    realpath: (...args) => delegate.realpath(...args),
    resolvePath: (...args) => delegate.resolvePath(...args),
    rm: async (...args) => {
      const found = locate(args[0]);
      // Removing the folder itself removes every item in it.
      const names =
        found?.name === ""
          ? await delegate.readdir(found.folder.root || "/").catch(() => [])
          : [];
      const whole = found
        ? (
            await Promise.all(names.map((name) => touchOf(found.folder, name)))
          ).filter((touch) => touch !== undefined)
        : [];
      const result = await tracked([{ path: args[0] }], () =>
        delegate.rm(...args),
      );
      for (const touch of whole) {
        recordSetupTouch(touch);
      }
      return result;
    },
    stat: (...args) => delegate.stat(...args),
    symlink: (...args) =>
      tracked([{ into: args[0], path: args[1] }], () =>
        delegate.symlink(...args),
      ),
    utimes: (...args) =>
      tracked([{ path: args[0] }], () => delegate.utimes(...args)),
    writeFile: (...args) =>
      tracked([{ path: args[0] }], () => delegate.writeFile(...args)),
  };
  if (readFileBytes) {
    wrapped.readFileBytes = readFileBytes;
  }
  if (readdirWithFileTypes) {
    wrapped.readdirWithFileTypes = readdirWithFileTypes;
  }
  // What `mktemp` makes its file with; without it a mount holding a setup
  // folder fails every `mktemp` there with ENOSYS.
  if (createExclusive) {
    wrapped.createExclusive = (...args) =>
      tracked([{ path: args[0] }], () => createExclusive(...args));
  }
  return wrapped;
}
