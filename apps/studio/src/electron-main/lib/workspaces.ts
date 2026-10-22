import {
  APP_FLAVOR,
  type AppFlavor,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import {
  instrumentFolderInDocuments,
  instrumentFolderUnchosen,
  isDirectorySync,
  type LayoutMarkStore,
  rewriteStoredPaths,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { z } from "zod";

import { pathKey, pathWithin, samePath } from "./path-identity";
import {
  type FolderConcern,
  folderConcernHere,
} from "./workspace-folder-check";

/**
 * Which workspace folder this process runs, out of the ones this machine knows.
 *
 * A workspace is a folder: the person's own work at the top level, and
 * everything the app keeps for it that travels with it under `.instrument/`
 * (its identity, its preferences, its chats, drafts and topics, laid out by
 * `workspaceLayout`). What is this computer's own about it (keys,
 * Chromium profiles, window state, folder rules) is in its machine folder,
 * `<userData>/machine/<local id>/`, named by the short id this machine's
 * registry gives it. The machine keeps a list of them in
 * `workspaces.json` at the root of userData, with the one to open next and
 * the id each one carries in its own `workspace.json`.
 *
 * Everything here is synchronous and never throws, because it runs in
 * `setup-environment.ts` before any store opens: a damaged registry has to
 * resolve to the default workspace rather than stop the app.
 */

export const DEFAULT_WORKSPACE_ID = "default";

/**
 * Where the default workspace starts, in userData, and stays until the
 * person picks a folder for it (`workspace-move.ts`).
 */
const DEFAULT_WORKSPACE_DIR_NAME = "workspace";

/** Where workspaces created after the default one are put. */
const WORKSPACES_DIR_NAME = "workspaces";

/**
 * Where this computer keeps each workspace's own data, one folder per local
 * id. Short, since a Chromium profile's deepest paths inside it come close to
 * Windows' 260 characters, and apart from `workspaces/`, which holds whole
 * workspaces made from the dev panel.
 */
const MACHINE_DIR_NAME = "machine";

const REGISTRY_FILENAME = "workspaces.json";
const IDENTITY_FILENAME = "workspace.json";

/** How long a local id made from a name may be, since it names a folder. */
export const LOCAL_ID_LENGTH = 32;

const WORKSPACE_COLORS = [
  "gray",
  "red",
  "orange",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export const WorkspaceColorSchema = z.enum(WORKSPACE_COLORS);

/**
 * An id that names a folder: letters, digits, `-` and `_`, so one read from a
 * file can never point outside the folder it is joined to.
 */
const FolderSafeIdSchema = z.string().regex(/^[\dA-Za-z][\w-]{0,63}$/);

const WorkspaceIdSchema = FolderSafeIdSchema;

const WorkspaceCreatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person") }),
  z.object({ kind: z.literal("agent"), purpose: z.string() }),
]);

/**
 * The format a workspace folder is in once what is this computer's own has
 * moved out of it, which `machine-data-migration.ts` brings it to and which
 * is all a move of the folder waits for.
 */
export const MACHINE_DATA_FORMAT_VERSION = 1;

/**
 * The format this build keeps a workspace folder in
 * (`WorkspaceIdentity.formatVersion`). 1: what is this computer's own lives in
 * the workspace's machine folder. 2: every chat's conversation is in its
 * records, which a build that reads one only from its `chat.db` would show
 * as an empty chat.
 */
export const WORKSPACE_FORMAT_VERSION = 2;

/**
 * What a workspace says about itself, kept inside it so a copied or moved
 * workspace keeps its name.
 */
export const WorkspaceIdentitySchema = z.object({
  color: WorkspaceColorSchema.catch("gray"),
  createdBy: WorkspaceCreatorSchema.catch({ kind: "person" }),
  /** Set once every chat in the workspace is on its records rather than a `chat.db`. */
  chatRecordsConverted: z.boolean().optional().catch(undefined),
  /**
   * The format the workspace folder is in. 1: what is this computer's own
   * (keys, browser profiles, window state, folder rules) lives in its
   * machine folder, not here. 2: each chat's conversation is in its records.
   */
  formatVersion: z.number().int().nonnegative().catch(0),
  /**
   * The workspace's own id, a ULID minted the first time a build that keeps
   * its machine data apart opens it, and the same on every computer it is
   * opened on. Each computer's registry records it beside the local id it
   * names that computer's folder for the workspace by.
   */
  id: WorkspaceIdSchema.optional().catch(undefined),
  /** The layout version the last finished sweep of `migrateWorkspaceLayout` left. */
  layoutVersion: z.number().int().nonnegative().optional().catch(undefined),
  /** Set once that sweep has taken in a 1.x `projects/` folder. */
  legacyProjectsMigrated: z.boolean().optional().catch(undefined),
  name: z.string().min(1).catch("Workspace"),
  /** How far `settings-migration.ts` has brought this workspace. */
  settingsVersion: z.number().int().nonnegative().catch(0),
});

const RegistryEntrySchema = z.object({
  /** This machine's short id for it, which also names its machine folder. */
  id: FolderSafeIdSchema,
  lastOpenedAt: z.number().optional(),
  path: z.string().min(1),
  /**
   * A move of its `.instrument/` the person asked for, from the folder it was
   * in when they asked to the one they picked, which the next launch makes
   * before anything opens it (`finishPendingMove`).
   */
  pendingMove: z
    .object({
      /**
       * What the copy this move made across volumes carries, written here
       * before the copy takes its place at the target, so a launch cut short
       * after that tells its own whole copy from a `.instrument` anything
       * else put there.
       */
      copyMark: z.string().min(1).optional().catch(undefined),
      from: z.string().min(1),
      /**
       * Set once the move is made but for deleting the original records it
       * renamed aside in `from`, which each launch tries again.
       */
      leftAside: z.literal(true).optional().catch(undefined),
      to: z.string().min(1),
    })
    .optional()
    .catch(undefined),
  /** The id in the workspace's own `workspace.json`, once a build has settled one. */
  workspaceId: WorkspaceIdSchema.optional().catch(undefined),
});

const RegistrySchema = z.object({
  active: z.string().optional().catch(undefined),
  // Entry by entry, so one damaged entry drops itself rather than the list.
  workspaces: z
    .array(z.unknown())
    .catch([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = RegistryEntrySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

export interface ResolvedWorkspace {
  id: string;
  isDefault: boolean;
  path: string;
  /**
   * Set by `INSTRUMENT_WORKSPACE`, for the life of the process. A pinned
   * process never moves `active`, which belongs to the person's own instance.
   */
  pinned: boolean;
}

/** The workspace this process runs, once its machine data is in place. */
export type OpenWorkspace = ResolvedWorkspace & {
  /** This computer's folder for it (`workspaceMachineDirOf`). */
  machineDir: string;
  /**
   * Its folder in `~/.instrument/work/`, which holds each chat's work
   * folder (`settleWorkFolders`).
   */
  workFoldersDir: string;
};
export type WorkspaceIdentity = z.output<typeof WorkspaceIdentitySchema>;
export type WorkspaceRegistry = z.output<typeof RegistrySchema>;

type RegistryEntry = z.output<typeof RegistryEntrySchema>;

export function createdWorkspacesDir(userDataDir: string): string {
  return path.join(userDataDir, WORKSPACES_DIR_NAME);
}

export function defaultWorkspacePath(userDataDir: string): string {
  return path.join(userDataDir, DEFAULT_WORKSPACE_DIR_NAME);
}

/**
 * Where finished work goes while the workspace is the app's own: the
 * flavor's Instrument folder in the home folder (`~/Instrument` for the app
 * people install), which macOS asks nothing about, so a first launch raises
 * no prompt over it.
 *
 * An install that already made the older folder in Documents keeps that one,
 * so its finished work does not end up split across two folders. Documents
 * is only looked in for a computer that has used the app before, since
 * looking there is the one thing a first launch must not do, and a refused
 * look reads as the folder not being there, which sends new work to the
 * home folder.
 */
export function unchosenOutputFolder(
  userDataDir: string,
  flavor: AppFlavor = APP_FLAVOR,
): string {
  const older = instrumentFolderInDocuments(flavor);
  return older !== undefined &&
    usedBefore(userDataDir) &&
    isDirectorySync(older)
    ? older
    : instrumentFolderUnchosen();
}

/**
 * Whether this computer has used the app before, by whether the workspace
 * the app keeps in its own data holds a chat.
 *
 * Not by its identity file: startup settles that before anything asks where
 * finished work goes, so on a first launch it is already there. A chat is
 * made by a person rather than by starting up, so a workspace with one has
 * been used, and the folder in Documents, if there is one, is where that
 * use put its finished work.
 */
function usedBefore(userDataDir: string): boolean {
  return workspaceHasChats(defaultWorkspacePath(userDataDir));
}

/** Whether a workspace holds a chat, which a person made by using it. */
export function workspaceHasChats(workspacePath: string): boolean {
  try {
    return fs.readdirSync(workspaceLayout(workspacePath).chatsDir).length > 0;
  } catch {
    // No workspace there yet, or none this account can read.
    return false;
  }
}

export function hasWorkspaceIdentity(workspacePath: string): boolean {
  return fs.existsSync(
    path.join(workspaceLayout(workspacePath).dataDir, IDENTITY_FILENAME),
  );
}

export function readRegistry(userDataDir: string): WorkspaceRegistry {
  return readRegistryFile(userDataDir).registry;
}

export function readWorkspaceIdentity(
  workspacePath: string,
): WorkspaceIdentity {
  const parsed = WorkspaceIdentitySchema.safeParse(
    readJson(
      path.join(workspaceLayout(workspacePath).dataDir, IDENTITY_FILENAME),
    ) ?? {},
  );
  return parsed.success ? parsed.data : WorkspaceIdentitySchema.parse({});
}

/**
 * Decide which workspace this process opens: the pin, then `active`, then the
 * default. What could not be honored comes back as `problems` for the log
 * rather than as an error, since every one of them has a safe answer.
 *
 * A pin may name a registered id or an absolute path. A path nobody registered
 * yet is registered, which is how an agent's clean room shows up in the
 * person's list without the agent writing the registry itself.
 */
export function resolveWorkspace({
  now = Date.now(),
  pin,
  userDataDir,
}: {
  now?: number;
  pin: string | undefined;
  userDataDir: string;
}): { problems: string[]; workspace: ResolvedWorkspace } {
  const problems: string[] = [];
  const unregistered = toResolved(
    { id: DEFAULT_WORKSPACE_ID, path: defaultWorkspacePath(userDataDir) },
    false,
  );

  try {
    let chosen = unregistered;
    // Decided inside the locked update, so an id picked for a new pin cannot
    // collide with one another process registers at the same moment.
    updateRegistry(userDataDir, (current) => {
      // The default workspace wherever it is now.
      const fallback = toResolved(
        current.workspaces.find((entry) => entry.id === DEFAULT_WORKSPACE_ID) ??
          unregistered,
        false,
      );
      chosen = chooseWorkspace({
        current,
        fallback,
        pin,
        problems,
        userDataDir,
      });
      if (chosen.pinned) {
        fs.mkdirSync(chosen.path, { recursive: true });
      }
      const entry: RegistryEntry = {
        ...current.workspaces.find((other) => other.id === chosen.id),
        id: chosen.id,
        lastOpenedAt: now,
        path: chosen.path,
      };
      const known = current.workspaces.some((other) => other.id === chosen.id);
      return {
        active: chosen.pinned ? current.active : chosen.id,
        workspaces: known
          ? current.workspaces.map((other) =>
              other.id === chosen.id ? entry : other,
            )
          : [...current.workspaces, entry],
      };
    });
    return { problems, workspace: chosen };
  } catch (error) {
    problems.push(
      `Could not settle the workspace (${String(error)}); opening the default workspace`,
    );
    // Where the registry, read without writing, says the default is: one
    // the person moved is opened there, never made again in userData.
    return {
      problems,
      workspace: toResolved(
        readRegistry(userDataDir).workspaces.find(
          (entry) => entry.id === DEFAULT_WORKSPACE_ID,
        ) ?? unregistered,
        false,
      ),
    };
  }
}

/**
 * The registry entry for the workspace in `dir`, a folder the person picked
 * that already holds one: the entry naming that folder, else the entry of
 * the same workspace whose folder is gone (moved by hand, or found again
 * after macOS stopped the app reading it), which keeps its local id and with
 * it its machine folder, and every path the app stored into its old folder
 * written here, else a new entry. Undefined when `dir` holds no
 * workspace, or only a link to one. Opening it is the caller's: `active` is
 * left as it is.
 */
export function registerWorkspaceFolder({
  dir,
  userDataDir,
}: {
  dir: string;
  userDataDir: string;
}): undefined | { id: string } {
  // A linked `.instrument` is no workspace's: opening it would settle a new
  // id through the link into the records it points to.
  if (
    !isDirectorySync(workspaceLayout(dir).dataDir) ||
    !hasWorkspaceIdentity(dir)
  ) {
    return undefined;
  }
  const moves: { from: string; id: string }[] = [];
  const registered: string[] = [];
  updateRegistry(userDataDir, (current) => {
    const known = current.workspaces.find((entry) => samePath(entry.path, dir));
    const moved = known ? undefined : movedTo(current, dir);
    const entry: RegistryEntry = {
      ...(known ?? moved),
      id: known?.id ?? moved?.id ?? idForPath(current, dir),
      path: known?.path ?? path.resolve(dir),
    };
    if (moved) {
      moves.push({ from: moved.path, id: moved.id });
    }
    registered.push(entry.id);
    return {
      ...current,
      workspaces: current.workspaces.some((other) => other.id === entry.id)
        ? current.workspaces.map((other) =>
            other.id === entry.id ? entry : other,
          )
        : [...current.workspaces, entry],
    };
  });
  const id = registered.at(-1);
  if (id === undefined) {
    return undefined;
  }
  const move = moves.at(-1);
  if (move) {
    rewriteStoredPaths({
      machineDir: workspaceMachineDirOf(userDataDir, move.id),
      moves: [{ from: move.from, to: path.resolve(dir) }],
      rootDir: path.resolve(dir),
    });
  }
  return { id };
}

/**
 * What's wrong with keeping the workspace in `dir` where it is (`folderConcern`),
 * against every other workspace this computer knows: entries naming the
 * same folder, the workspace with registry id `id`, or the same workspace
 * by the id in its `workspace.json` (one moved by hand) are its own.
 */
export function workspacePlaceConcern({
  dir,
  id,
  userDataDir,
}: {
  dir: string;
  id?: string;
  userDataDir: string;
}): FolderConcern | undefined {
  const workspaceId = readWorkspaceIdentity(dir).id;
  return folderConcernHere({
    folder: dir,
    otherWorkspaces: readRegistry(userDataDir)
      .workspaces.filter(
        (entry) =>
          entry.id !== id &&
          !samePath(entry.path, dir) &&
          (workspaceId === undefined || entry.workspaceId !== workspaceId),
      )
      .map((entry) => entry.path),
    userDataDir,
  });
}

/**
 * Change the registry from its current contents on disk. Several processes can
 * share one userData (worktrees, an agent's driven instance), so a write never
 * starts from a copy read earlier.
 */
export function updateRegistry(
  userDataDir: string,
  change: (registry: WorkspaceRegistry) => WorkspaceRegistry,
): WorkspaceRegistry {
  return withRegistryLock(userDataDir, () =>
    changeRegistry(userDataDir, change),
  );
}

/**
 * The machine folder of a registered workspace, when it has one: the folder
 * its local id names says it belongs to the id in the workspace's own
 * `workspace.json`. Undefined for a workspace no build that keeps machine
 * data apart has opened yet.
 */
export function machineDirOwnedBy(
  userDataDir: string,
  workspace: { id: string; path: string },
): string | undefined {
  const machineDir = workspaceMachineDirOf(userDataDir, workspace.id);
  const owner = readOwner(machineDir);
  return owner !== undefined &&
    owner === readWorkspaceIdentity(workspace.path).id
    ? machineDir
    : undefined;
}

/**
 * Settle the workspace's id and its machine folder before the folder is
 * first used, and answer the folder. The id in its `workspace.json` is minted
 * where neither it nor the registry has one, and minted again for a copy of a
 * workspace another entry still holds with the same id, so the copy starts
 * with machine data of its own (signed out, a fresh browser) rather than
 * sharing the original's keys and profiles. The registry entry records it, so
 * the workspace is known by it on every computer that opens it. A machine
 * folder another workspace left under the same local id (one deleted outside
 * the app, its id since reused) is set aside beside it, never handed over.
 * Under the registry's lock, so two processes opening one workspace at once
 * settle on one id.
 */
export function settleWorkspace({
  newId = ulid,
  userDataDir,
  workspace,
}: {
  newId?: () => string;
  userDataDir: string;
  workspace: { id: string; path: string };
}): string {
  return withRegistryLock(userDataDir, () => {
    const { registry } = readRegistryFile(userDataDir);
    const identity = readWorkspaceIdentity(workspace.path);
    const entry = registry.workspaces.find(
      (other) => other.id === workspace.id,
    );
    let workspaceId = identity.id ?? entry?.workspaceId;
    const copied =
      workspaceId !== undefined &&
      registry.workspaces.some(
        (other) =>
          other.id !== workspace.id &&
          other.workspaceId === workspaceId &&
          !samePath(other.path, workspace.path) &&
          readWorkspaceIdentity(other.path).id === workspaceId,
      );
    if (workspaceId === undefined || copied) {
      workspaceId = newId();
    }
    if (identity.id !== workspaceId) {
      writeWorkspaceIdentity(workspace.path, { ...identity, id: workspaceId });
    }
    if (entry && entry.workspaceId !== workspaceId) {
      const recorded = workspaceId;
      changeRegistry(userDataDir, (current) => ({
        ...current,
        workspaces: current.workspaces.map((other) =>
          other.id === workspace.id
            ? { ...other, workspaceId: recorded }
            : other,
        ),
      }));
    }

    const machineDir = workspaceMachineDirOf(userDataDir, workspace.id);
    const owner = readOwner(machineDir);
    if (owner !== undefined && owner !== workspaceId) {
      const aside = `${machineDir}.${owner}`;
      fs.renameSync(
        machineDir,
        fs.existsSync(aside) ? `${aside}.${Date.now().toString()}` : aside,
      );
    }
    if (owner !== workspaceId) {
      writeJsonAtomic(path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.owner), {
        workspaceId,
      });
    }
    return machineDir;
  });
}

/**
 * Where `migrateWorkspaceLayout` keeps how far it has brought the workspace:
 * two fields of its `workspace.json`, so the record travels with the folders
 * it describes.
 */
export function workspaceLayoutMarks(workspacePath: string): LayoutMarkStore {
  return {
    read: () => {
      const { layoutVersion, legacyProjectsMigrated } =
        readWorkspaceIdentity(workspacePath);
      return { layoutVersion, legacyProjectsMigrated };
    },
    write: (change) => {
      writeWorkspaceIdentity(workspacePath, {
        ...readWorkspaceIdentity(workspacePath),
        ...change,
      });
    },
  };
}

/**
 * This computer's folder for the workspace with this local id (its registry
 * id): what is secret, means something only here, or is rebuilt here
 * (`WORKSPACE_MACHINE_ENTRIES`), none of which travels with the workspace
 * folder.
 */
export function workspaceMachineDirOf(
  userDataDir: string,
  localId: string,
): string {
  return path.join(userDataDir, MACHINE_DIR_NAME, localId);
}

/**
 * The workspace's database on this computer, `workspace.db`, at the top of
 * its machine folder (`workspaceMachineDirOf`), so a workspace whose folder
 * moves keeps it.
 */
export function workspaceDbFileOf(machineDir: string): string {
  return path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.database);
}

/** Write through a sibling and rename, so a crash mid-write leaves the old file. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid.toString()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

export function writeWorkspaceIdentity(
  workspacePath: string,
  identity: WorkspaceIdentity,
): void {
  writeJsonAtomic(
    path.join(workspaceLayout(workspacePath).dataDir, IDENTITY_FILENAME),
    identity,
  );
}

/**
 * The pin, then `active`, then the default. A workspace in userData whose
 * folder is gone gives way to the default, since the app made it and can
 * make the default again; one in a folder the person picked never does,
 * since opening another in its place would read as their chats being gone:
 * the boot says it cannot read the folder instead (`workspace-refusal.ts`).
 */
function chooseWorkspace({
  current,
  fallback,
  pin,
  problems,
  userDataDir,
}: {
  current: WorkspaceRegistry;
  fallback: ResolvedWorkspace;
  pin: string | undefined;
  problems: string[];
  userDataDir: string;
}): ResolvedWorkspace {
  if (pin) {
    if (path.isAbsolute(pin)) {
      const known = current.workspaces.find((entry) =>
        samePath(entry.path, pin),
      );
      const moved = known ? undefined : movedTo(current, pin);
      return toResolved(
        known ??
          (moved
            ? { ...moved, path: path.resolve(pin) }
            : { id: idForPath(current, pin), path: path.resolve(pin) }),
        true,
      );
    }
    const known = current.workspaces.find((entry) => entry.id === pin);
    if (known && isDirectory(known.path)) {
      return toResolved(known, true);
    }
    problems.push(
      `INSTRUMENT_WORKSPACE names "${pin}", which is not a registered workspace with a folder; opening the default workspace`,
    );
    return fallback;
  }
  if (current.active && current.active !== DEFAULT_WORKSPACE_ID) {
    const known = current.workspaces.find(
      (entry) => entry.id === current.active,
    );
    if (
      known &&
      (isDirectory(known.path) || !pathWithin(known.path, userDataDir))
    ) {
      return toResolved(known, false);
    }
    problems.push(
      `The active workspace "${current.active}" has no folder any more; opening the default workspace`,
    );
  }
  return fallback;
}

/**
 * A registry id for a folder named from outside: its name, made unique. Kept
 * short, since it names the workspace's machine folder.
 */
function idForPath(registry: WorkspaceRegistry, workspacePath: string) {
  const base =
    path
      .basename(workspacePath)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .slice(0, LOCAL_ID_LENGTH)
      .replaceAll(/^-|-$/g, "") || "workspace";
  let id = base;
  for (let n = 2; registry.workspaces.some((entry) => entry.id === id); n++) {
    id = `${base}-${n.toString()}`;
  }
  return id;
}

/**
 * The entry of a workspace whose id the folder at `workspacePath` carries
 * and whose own folder no longer holds it (gone, unreadable, or something
 * else there now): the same workspace, moved, which keeps its local id and
 * with it its machine folder, sign-ins included. A copy, whose original is
 * still where its entry says, is a workspace of its own.
 */
function movedTo(registry: WorkspaceRegistry, workspacePath: string) {
  const { id } = readWorkspaceIdentity(workspacePath);
  return id === undefined
    ? undefined
    : registry.workspaces.find(
        (entry) =>
          entry.workspaceId === id &&
          !samePath(entry.path, workspacePath) &&
          readWorkspaceIdentity(entry.path).id !== id,
      );
}

function isDirectory(dir: string) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The default workspace first, in userData's own folder until the person
 * picks one for it, and each folder listed once, by the folder its path names
 * however it is spelled (`pathKey`): a second entry for a folder already
 * listed (the default one under another id, say) would let it be mistaken
 * for a different workspace. An entry whose folder cannot be reached stays:
 * a disk not plugged in, or a folder macOS stopped the app reading, comes
 * back.
 */
function normalize(
  registry: WorkspaceRegistry,
  userDataDir: string,
): WorkspaceRegistry {
  const defaultEntry = registry.workspaces.find(
    (entry) => entry.id === DEFAULT_WORKSPACE_ID,
  ) ?? { id: DEFAULT_WORKSPACE_ID, path: defaultWorkspacePath(userDataDir) };
  const seen = new Set<string>();
  const workspaces: RegistryEntry[] = [];
  const others = registry.workspaces.filter(
    (other) => other.id !== DEFAULT_WORKSPACE_ID,
  );
  for (const entry of [defaultEntry, ...others]) {
    const key = pathKey(entry.path);
    if (!seen.has(key)) {
      seen.add(key);
      workspaces.push(entry);
    }
  }
  return { ...registry, workspaces };
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Read the registry, with paths inside this userData made absolute again. They
 * are stored relative to it, so a copied application-data directory (an APFS
 * clone under ELECTRON_USER_DATA_DIR) opens its own workspaces rather than the
 * original's.
 */
function readRegistryFile(userDataDir: string): {
  registry: WorkspaceRegistry;
  unreadable: boolean;
} {
  const file = registryPath(userDataDir);
  const raw = readJson(file);
  const parsed = RegistrySchema.safeParse(raw ?? {});
  const unreadable =
    fs.existsSync(file) && (raw === undefined || !parsed.success);
  const registry = parsed.success ? parsed.data : { workspaces: [] };
  return {
    registry: normalize(
      {
        ...registry,
        workspaces: registry.workspaces.map((entry) => ({
          ...entry,
          path: path.resolve(userDataDir, entry.path),
          ...(entry.pendingMove && {
            pendingMove: {
              ...entry.pendingMove,
              from: path.resolve(userDataDir, entry.pendingMove.from),
            },
          }),
        })),
      },
      userDataDir,
    ),
    unreadable,
  };
}

/** The registry change of `updateRegistry`, for a caller already holding its lock. */
function changeRegistry(
  userDataDir: string,
  change: (registry: WorkspaceRegistry) => WorkspaceRegistry,
): WorkspaceRegistry {
  const { registry, unreadable } = readRegistryFile(userDataDir);
  if (unreadable) {
    // Kept rather than overwritten: it may list workspaces outside
    // `workspaces/`, which nothing else would find again.
    fs.copyFileSync(
      registryPath(userDataDir),
      `${registryPath(userDataDir)}.unreadable-${Date.now().toString()}`,
    );
  }
  const next = normalize(change(registry), userDataDir);
  writeJsonAtomic(registryPath(userDataDir), {
    ...next,
    workspaces: next.workspaces.map((entry) => ({
      ...entry,
      path: storedPath(entry.path, userDataDir),
      ...(entry.pendingMove && {
        pendingMove: {
          ...entry.pendingMove,
          from: storedPath(entry.pendingMove.from, userDataDir),
        },
      }),
    })),
  });
  return next;
}

function registryPath(userDataDir: string) {
  return path.join(userDataDir, REGISTRY_FILENAME);
}

function storedPath(workspacePath: string, userDataDir: string) {
  const relative = path.relative(userDataDir, workspacePath);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? workspacePath
    : relative;
}

function toResolved(entry: RegistryEntry, pinned: boolean): ResolvedWorkspace {
  return {
    id: entry.id,
    isDefault: entry.id === DEFAULT_WORKSPACE_ID,
    path: entry.path,
    pinned,
  };
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 2000;

/**
 * Serialize registry writes across processes with a lock file. A boot is
 * never held hostage to it: past the wait, or on a lock older than any write
 * takes, the update goes ahead.
 */
function withRegistryLock<T>(userDataDir: string, run: () => T): T {
  const lock = `${registryPath(userDataDir)}.lock`;
  fs.mkdirSync(userDataDir, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      fs.writeFileSync(lock, process.pid.toString(), { flag: "wx" });
      held = true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return run();
  } finally {
    if (held) {
      fs.rmSync(lock, { force: true });
    }
  }
}

/**
 * Whether this computer has never had a workspace: no registry, no default
 * workspace folder in the app's own data, and no settings 1.x left at its
 * root. Such a launch opens none, registers none, and setup's first step
 * places one where the person picks, since the app runs only from a
 * workspace the person chose.
 */
export function isFirstLaunch(userDataDir: string): boolean {
  return ![
    registryPath(userDataDir),
    defaultWorkspacePath(userDataDir),
    path.join(userDataDir, "preferences.json"),
  ].some((entry) => fs.existsSync(entry));
}

/**
 * Takes the default local id's machine folder for a first launch, setting
 * aside one a workspace no registry lists left behind (its owner record says
 * whose it was), before the window's session opens in it. The workspace
 * setup places then starts from it as its own.
 */
export function claimUnplacedMachineDir(userDataDir: string): string {
  const machineDir = workspaceMachineDirOf(userDataDir, DEFAULT_WORKSPACE_ID);
  const owner = readOwner(machineDir);
  if (owner !== undefined) {
    const aside = `${machineDir}.${owner}`;
    fs.renameSync(
      machineDir,
      fs.existsSync(aside) ? `${aside}.${Date.now().toString()}` : aside,
    );
  }
  fs.mkdirSync(machineDir, { recursive: true });
  return machineDir;
}

/**
 * Mark the workspace whose machine folder this is open in this process, until
 * `releaseOpenMark`. Advisory: it does not stop a second process opening the
 * same workspace (worktrees share the default one), only a delete from under
 * a running one. On this computer's side, since a process id means nothing
 * on another.
 */
export function markWorkspaceOpen(machineDir: string): void {
  // A live process already holding it keeps its mark: a second process (a
  // single-instance lock loser on its way out, a second worktree) would
  // otherwise take the mark and then remove it on exit.
  if (openElsewhereBy(machineDir) !== null) {
    return;
  }
  try {
    fs.mkdirSync(machineDir, { recursive: true });
    fs.writeFileSync(openPidPath(machineDir), process.pid.toString());
  } catch {
    // Advisory; a workspace that cannot be marked still opens.
  }
}

/**
 * The pid of another live process holding open the workspace marked in
 * `markDir` (its machine folder), if any. A live process counts only when it
 * runs this app's program: a mark left by a process that ended without
 * removing it (a crash, the computer shutting down) names a pid the system
 * may since have given to another program.
 */
export function openElsewhereBy(markDir: string): null | number {
  return liveHolderOf(openPidPath(markDir));
}

/**
 * The pid a file names, when it is another live process running this app's
 * program, as `openElsewhereBy` reads the open mark.
 */
export function liveHolderOf(pidFile: string): null | number {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return null;
  }
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return runsThisApp(pid) ? pid : null;
}

/**
 * Whether the live process `pid` runs the same program as this one, by the
 * name of its executable. The name rather than the whole path, since each
 * worktree's development build runs its own copy of Electron. Where the
 * system will not say, it is taken to: trusting a mark too long only defers
 * a move to a later boot, while dropping a live one lets two processes move
 * one workspace's data at once.
 */
function runsThisApp(pid: number): boolean {
  const name = executableNameOf(pid);
  if (name === undefined) {
    return true;
  }
  const own = path.basename(process.execPath);
  return process.platform === "win32"
    ? name.toLowerCase() === own.toLowerCase()
    : name === own;
}

/**
 * The name the system gives the executable a process runs, "" when no
 * process has that pid any more, and undefined when the system would not
 * say. Read from `/proc` on Linux and asked of `ps` on a Mac and `tasklist`
 * on Windows, each part of the system.
 *
 * On Linux it is the program `/proc/<pid>/exe` leads to rather than
 * `/proc/<pid>/comm`, which is the name of the process's first thread: Node
 * calls that one "MainThread" and Chromium calls the browser process's
 * "CrBrowserMain", so comm never names the program for anything this app
 * runs. A link this account cannot read answers undefined, which counts the
 * process as this app's, as a system that will not say does.
 */
function executableNameOf(pid: number): string | undefined {
  const ask = (file: string, args: string[]) =>
    execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
    });
  try {
    switch (process.platform) {
      case "linux":
        return path.basename(fs.readlinkSync(`/proc/${pid.toString()}/exe`));
      case "win32": {
        const row = /^"([^"]*)","(\d+)"/m.exec(
          ask("tasklist", [
            "/FI",
            `PID eq ${pid.toString()}`,
            "/FO",
            "CSV",
            "/NH",
          ]),
        );
        return row?.[2] === pid.toString() ? (row[1] ?? "") : "";
      }
      default:
        return path.basename(
          ask("ps", ["-p", pid.toString(), "-o", "comm="]).trim(),
        );
    }
  } catch {
    return undefined;
  }
}

export function releaseOpenMark(machineDir: string): void {
  try {
    if (
      fs.readFileSync(openPidPath(machineDir), "utf8").trim() ===
      process.pid.toString()
    ) {
      fs.rmSync(openPidPath(machineDir));
    }
  } catch {
    // Already gone, or another process took it over.
  }
}

function openPidPath(markDir: string) {
  return path.join(markDir, WORKSPACE_MACHINE_ENTRIES.openMark);
}

/** The workspace id a machine folder's record says it belongs to. */
export function readOwner(machineDir: string): string | undefined {
  const parsed = z
    .object({ workspaceId: WorkspaceIdSchema })
    .safeParse(
      readJson(path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.owner)),
    );
  return parsed.success ? parsed.data.workspaceId : undefined;
}
