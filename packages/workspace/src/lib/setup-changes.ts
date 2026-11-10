import { type IFileSystem } from "just-bash";
import fs from "node:fs/promises";
import path from "node:path";

import {
  APPS_FOLDER_NAME,
  PROJECT_FILE_NAME,
  PROJECTS_FOLDER_NAME,
} from "../constants";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { APP_FILE_NAME } from "./apps/app-file";
import { memoryDir } from "./memory/store";
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
 * skill (a folder in `Skills/`), an app (a folder in `Apps/`), a project (a
 * folder in `Projects/`), a memory (a file in `Memory/`). Each is named the way
 * its folder or file is.
 */
export type SetupKind = "app" | "memory" | "skill" | "project";

/**
 * Where each kind lives, how a name in its folder is an item, the file that
 * says what it is, and what makes the item there: a skill folder without its
 * `SKILL.md` is not a skill, while every folder in `Projects/` is a project,
 * its `AGENTS.md` only what it says.
 */
export const SETUP_KINDS: Record<
  SetupKind,
  {
    folder: () => string;
    /** The item a name directly in the folder is, if any. */
    itemOf: (entry: string) => string | undefined;
    /** The marker's path inside the folder. */
    marker: (name: string) => string;
    /** The path inside the folder whose presence makes the item there. */
    presence: (name: string) => string;
  }
> = {
  app: {
    folder: () => path.join(getWorkspaceConfig().rootDir, APPS_FOLDER_NAME),
    itemOf: (entry) => entry,
    marker: (name) => `${name}/${APP_FILE_NAME}`,
    presence: (name) => `${name}/${APP_FILE_NAME}`,
  },
  memory: {
    folder: () => memoryDir(),
    itemOf: (entry) => (entry.endsWith(".md") ? entry.slice(0, -3) : undefined),
    marker: (name) => `${name}.md`,
    presence: (name) => `${name}.md`,
  },
  skill: {
    folder: () => getWorkspaceSkillsDir(),
    itemOf: (entry) => entry,
    marker: (name) => `${name}/SKILL.md`,
    presence: (name) => `${name}/SKILL.md`,
  },
  project: {
    folder: () => path.join(getWorkspaceConfig().rootDir, PROJECTS_FOLDER_NAME),
    itemOf: (entry) => entry,
    marker: (name) => `${name}/${PROJECT_FILE_NAME}`,
    presence: (name) => name,
  },
};

/** One item of the setup this turn wrote to, and whether it was there first. */
export interface SetupTouch {
  existedBefore: boolean;
  kind: SetupKind;
  name: string;
}

type ProjectFieldChange = SessionMessageDataPart.ProjectFieldChange;
type ProjectLooks = SessionMessageDataPart.ChangedProjectLooks;

export interface SetupChange {
  change: "added" | "changed" | "removed";
  /** A memory `instrument memory` saved or forgot: its text on either side of the turn. */
  memory?: MemoryTexts;
  /** What a command changed about a project, each with its value from before the turn. */
  fields?: ProjectFieldChange[];
  kind: SetupKind;
  name: string;
  /** A project a command changed or made, as it looked before the turn and after. */
  project?: ProjectLooks;
}

/** A memory's text on either side of the turn, `null` for none. */
interface MemoryTexts {
  after: string | null;
  before: string | null;
}

interface TurnTracker {
  /** What `instrument memory` saved or forgot, by the memory's name. */
  memoryTexts: Map<string, MemoryTexts>;
  /** What `instrument projects` set, by the project's name now and then by field. */
  fields: Map<string, Map<ProjectFieldChange["field"], ProjectFieldChange>>;
  /** How each project a command changed or made looked before the turn and now, by its name now. */
  looks: Map<string, ProjectLooks>;
  /** Projects a command renamed, by their old names, which are not projects gone. */
  renamedFrom: Set<string>;
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
  TURNS.set(turnKey(turn), {
    fields: new Map(),
    memoryTexts: new Map(),
    looks: new Map(),
    renamedFrom: new Set(),
    touched: new Map(),
    turnId: beginTurn(turn),
  });
}

/**
 * Records that the turn running now changed one item of the setup: a write
 * through the agent's own shell or file tools, one of our commands, or what a
 * program the turn ran was seen to change (`setup-snapshot.ts`). A change the
 * person or another chat made is not recorded, unless it landed while this
 * turn's program ran, when it cannot be told apart.
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
 * Records what a command set about one project in the turn running now, or
 * that it made one (`before` absent), as a touch of the project, the fields
 * it changed and how it looked on either side. A second change to a field
 * keeps the value from before the first, and a second change to a project
 * its look from before the first, so the note says what the turn did as a
 * whole. A rename moves what was recorded under the old name to the new one.
 */
export function recordProjectChange(
  project: ProjectLooks,
  changes: readonly ProjectFieldChange[],
): void {
  const tracker = trackerForCurrentTurn();
  if (!tracker) {
    return;
  }
  const name = {
    after: project.after.name,
    before: project.before?.name ?? project.after.name,
  };
  const fields =
    tracker.fields.get(name.before) ??
    new Map<ProjectFieldChange["field"], ProjectFieldChange>();
  tracker.fields.delete(name.before);
  const looks = tracker.looks.get(name.before);
  tracker.looks.delete(name.before);
  const before = looks ? looks.before : project.before;
  const touched = tracker.touched.get(`project:${name.before}`);
  if (name.before !== name.after) {
    tracker.touched.delete(`project:${name.before}`);
    tracker.renamedFrom.add(name.before);
  }
  for (const change of changes) {
    const first = fields.get(change.field);
    fields.set(
      change.field,
      first === undefined
        ? change
        : // The changes of one key are of one field, so the first's `before`
          // is of this change's kind.
          ({ ...change, before: first.before } as ProjectFieldChange),
    );
  }
  tracker.fields.set(name.after, fields);
  tracker.looks.set(name.after, {
    after: project.after,
    ...(before ? { before } : {}),
    id: project.id,
  });
  const key = `project:${name.after}`;
  if (!tracker.touched.has(key)) {
    tracker.touched.set(key, {
      existedBefore: touched?.existedBefore ?? project.before !== undefined,
      kind: "project",
      name: name.after,
    });
  }
}

/**
 * Records what `instrument memory` saved or forgot in the turn running now:
 * a touch of the memory, and its text before and after. A second change to
 * the same memory keeps the text from before the first, so the card says
 * what the turn did as a whole and Undo goes back to before it.
 */
export function recordMemoryChange(name: string, texts: MemoryTexts): void {
  const tracker = trackerForCurrentTurn();
  if (!tracker) {
    return;
  }
  const first = tracker.memoryTexts.get(name);
  tracker.memoryTexts.set(name, {
    after: texts.after,
    before: first ? first.before : texts.before,
  });
  const key = `memory:${name}`;
  if (!tracker.touched.has(key)) {
    tracker.touched.set(key, {
      existedBefore: texts.before !== null,
      kind: "memory",
      name,
    });
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
    [...tracker.touched.values()]
      // A folder a rename moved is seen gone by whatever watched the write.
      .filter(
        (touch) =>
          touch.kind !== "project" || !tracker.renamedFrom.has(touch.name),
      )
      .map(async (touch) => {
        const exists = await setupItemExists(touch.kind, touch.name);
        const change: SetupChange["change"] | undefined = touch.existedBefore
          ? exists
            ? "changed"
            : "removed"
          : exists
            ? "added"
            : undefined;
        if (!change) {
          return [];
        }
        const fields =
          change === "changed" && touch.kind === "project"
            ? [...(tracker.fields.get(touch.name)?.values() ?? [])].filter(
                (field) => field.before !== field.after,
              )
            : [];
        const looks =
          touch.kind === "project" && change !== "removed"
            ? tracker.looks.get(touch.name)
            : undefined;
        // A project the turn made had no look before it.
        const project =
          looks && change === "added"
            ? { after: looks.after, id: looks.id }
            : looks;
        const memory =
          touch.kind === "memory"
            ? tracker.memoryTexts.get(touch.name)
            : undefined;
        return [
          {
            change,
            ...(fields.length > 0 ? { fields } : {}),
            kind: touch.kind,
            ...(memory ? { memory } : {}),
            name: touch.name,
            ...(project ? { project } : {}),
          },
        ];
      }),
  );
  return changes
    .flat()
    .toSorted(
      (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    );
}

/** Whether an item of that kind and name is there now. */
async function setupItemExists(kind: SetupKind, name: string) {
  const { folder, presence } = SETUP_KINDS[kind];
  return fs.stat(path.join(folder(), presence(name))).then(
    (stats) => (kind === "project" ? stats.isDirectory() : stats.isFile()),
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

/** A setup folder as a mounted filesystem names it. */
export interface SetupFolder {
  kind: SetupKind;
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
  const presenceOf = (folder: SetupFolder, name: string) =>
    `${folder.root}/${SETUP_KINDS[folder.kind].presence(name)}`;

  /** The folder a path is in, and the item it names there ("" for the folder itself). */
  const locate = (given: string) => {
    const target = path.posix.normalize(`/${given}`).replace(/\/+$/, "");
    for (const folder of folders) {
      if (target === folder.root) {
        return { folder, name: "" };
      }
      if (target.startsWith(`${folder.root}/`)) {
        const rest = target.slice(folder.root.length + 1);
        const entry = rest.split("/")[0] ?? "";
        // A project's folder is where its lasting files go, so only its
        // instructions file, or the folder whole, is a change to the project.
        if (
          folder.kind === "project" &&
          rest !== entry &&
          rest !== SETUP_KINDS.project.marker(entry)
        ) {
          return undefined;
        }
        return { folder, name: SETUP_KINDS[folder.kind].itemOf(entry) };
      }
    }
    return undefined;
  };

  const touchOf = async (
    folder: SetupFolder,
    name: string | undefined,
  ): Promise<SetupTouch | undefined> =>
    name === undefined || name === "" || name === "."
      ? undefined
      : {
          existedBefore: await delegate.exists(presenceOf(folder, name)),
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
      const touch = await touchOf(
        found.folder,
        SETUP_KINDS[found.folder.kind].itemOf(path.posix.basename(into)),
      );
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
            await Promise.all(
              names.map((entry) =>
                touchOf(
                  found.folder,
                  SETUP_KINDS[found.folder.kind].itemOf(entry),
                ),
              ),
            )
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
