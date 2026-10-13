import {
  PRIVATE_FOLDER_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import type { LayoutMarkStore } from "@instrument-org/workspace/electron";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { z } from "zod";

/**
 * Which workspace folder this process runs, out of the ones this machine knows.
 *
 * A workspace is a folder: chats, tasks, and the rest at the top level, and
 * what the app keeps for it that travels with it under `.instrument/` (its
 * identity, its preferences). What is this computer's own about it (keys,
 * Chromium profiles, window state, folder rules) is in its machine folder,
 * `<userData>/workspace-storage/<workspace id>/`, under the id in its
 * `workspace.json`. The machine keeps a list of them in `workspaces.json` at
 * the root of userData, with the one to open next.
 *
 * Everything here is synchronous and never throws, because it runs in
 * `setup-environment.ts` before any store opens: a damaged registry has to
 * resolve to the default workspace rather than stop the app.
 */

export const DEFAULT_WORKSPACE_ID = "default";

/** The default workspace's folder, which predates the registry and never moves. */
const DEFAULT_WORKSPACE_DIR_NAME = "workspace";

/** Where workspaces created after the default one are put. */
const WORKSPACES_DIR_NAME = "workspaces";

/**
 * Where this computer keeps each workspace's own data, one folder per
 * workspace id. Not `workspaces/`, which holds whole workspaces made from the
 * dev panel: one folder name meaning two kinds of thing would let a listing
 * or a delete take the wrong one.
 */
const WORKSPACE_STORAGE_DIR_NAME = "workspace-storage";

const REGISTRY_FILENAME = "workspaces.json";
const IDENTITY_FILENAME = "workspace.json";

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

const WorkspaceCreatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person") }),
  z.object({ kind: z.literal("agent"), purpose: z.string() }),
]);

/**
 * What a workspace says about itself, kept inside it so a copied or moved
 * workspace keeps its name.
 */
export const WorkspaceIdentitySchema = z.object({
  color: WorkspaceColorSchema.catch("gray"),
  createdBy: WorkspaceCreatorSchema.catch({ kind: "person" }),
  /**
   * The format the workspace folder is in. 1: what is this computer's own
   * (keys, browser profiles, window state, folder rules) lives in its
   * machine folder, not here.
   */
  formatVersion: z.number().int().nonnegative().catch(0),
  /**
   * The workspace's own id, a ULID minted the first time a build that keeps
   * its machine data apart opens it, and what that data is kept under. It
   * names a folder, so anything but letters, digits, `-` and `_` reads as
   * none and a new one is minted.
   */
  id: z
    .string()
    .regex(/^[\dA-Za-z][\w-]{0,63}$/)
    .optional()
    .catch(undefined),
  /** The layout version the last finished sweep of `migrateWorkspaceLayout` left. */
  layoutVersion: z.number().int().nonnegative().optional().catch(undefined),
  /** Set once that sweep has taken in a 1.x `projects/` folder. */
  legacyProjectsMigrated: z.boolean().optional().catch(undefined),
  name: z.string().min(1).catch("Workspace"),
  /** How far `settings-migration.ts` has brought this workspace. */
  settingsVersion: z.number().int().nonnegative().catch(0),
});

const RegistryEntrySchema = z.object({
  id: z.string().min(1),
  lastOpenedAt: z.number().optional(),
  path: z.string().min(1),
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

export function hasWorkspaceIdentity(workspacePath: string): boolean {
  return fs.existsSync(
    path.join(workspacePrivateDir(workspacePath), IDENTITY_FILENAME),
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
      path.join(workspacePrivateDir(workspacePath), IDENTITY_FILENAME),
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
  const fallback = toResolved(
    { id: DEFAULT_WORKSPACE_ID, path: defaultWorkspacePath(userDataDir) },
    false,
  );

  try {
    let chosen = fallback;
    // Decided inside the locked update, so an id picked for a new pin cannot
    // collide with one another process registers at the same moment.
    updateRegistry(userDataDir, (current) => {
      chosen = chooseWorkspace({ current, fallback, pin, problems });
      if (chosen.pinned) {
        fs.mkdirSync(chosen.path, { recursive: true });
      }
      const entry: RegistryEntry = {
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
    return { problems, workspace: fallback };
  }
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
  return withRegistryLock(userDataDir, () => {
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
      })),
    });
    return next;
  });
}

/**
 * The machine folder of the workspace at `workspacePath`, when it has one: it
 * has an id, and that id's folder says it belongs to this workspace.
 * Undefined for a workspace no build that keeps machine data apart has opened
 * yet, and for a copy of another still carrying its original's id.
 */
export function machineDirOwnedBy(
  userDataDir: string,
  workspacePath: string,
): string | undefined {
  const { id } = readWorkspaceIdentity(workspacePath);
  if (id === undefined) {
    return undefined;
  }
  const machineDir = workspaceMachineDirOf(userDataDir, id);
  const owner = readOwner(userDataDir, machineDir);
  return owner !== undefined && samePath(owner, workspacePath)
    ? machineDir
    : undefined;
}

/**
 * The workspace's id from its `workspace.json`, settled before its machine
 * folder is first used. Minted where it has none, and minted again for a copy
 * of a workspace whose folder is still there with the same id, so the copy
 * starts with machine data of its own (signed out, a fresh browser) rather
 * than sharing the original's keys and profiles. A workspace whose folder
 * moved finds its id's folder recorded for a path that no longer holds it,
 * and takes it over. Under the registry's lock, so two processes opening one
 * workspace at once settle on one id.
 */
export function settleWorkspaceId({
  newId = ulid,
  userDataDir,
  workspacePath,
}: {
  newId?: () => string;
  userDataDir: string;
  workspacePath: string;
}): string {
  return withRegistryLock(userDataDir, () => {
    const identity = readWorkspaceIdentity(workspacePath);
    if (identity.id !== undefined) {
      const machineDir = workspaceMachineDirOf(userDataDir, identity.id);
      const owner = readOwner(userDataDir, machineDir);
      if (owner !== undefined && samePath(owner, workspacePath)) {
        return identity.id;
      }
      if (
        owner === undefined ||
        readWorkspaceIdentity(owner).id !== identity.id
      ) {
        writeOwner(userDataDir, machineDir, workspacePath);
        return identity.id;
      }
    }
    const id = newId();
    writeWorkspaceIdentity(workspacePath, { ...identity, id });
    writeOwner(
      userDataDir,
      workspaceMachineDirOf(userDataDir, id),
      workspacePath,
    );
    return id;
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
 * This computer's folder for the workspace with this id: what is secret,
 * means something only here, or is rebuilt here (`WORKSPACE_MACHINE_ENTRIES`),
 * none of which travels with the workspace folder.
 */
export function workspaceMachineDirOf(
  userDataDir: string,
  workspaceId: string,
): string {
  return path.join(userDataDir, WORKSPACE_STORAGE_DIR_NAME, workspaceId);
}

export function workspacePrivateDir(workspacePath: string): string {
  return path.join(workspacePath, PRIVATE_FOLDER_NAME);
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
    path.join(workspacePrivateDir(workspacePath), IDENTITY_FILENAME),
    identity,
  );
}

function chooseWorkspace({
  current,
  fallback,
  pin,
  problems,
}: {
  current: WorkspaceRegistry;
  fallback: ResolvedWorkspace;
  pin: string | undefined;
  problems: string[];
}): ResolvedWorkspace {
  if (pin) {
    if (path.isAbsolute(pin)) {
      const known = current.workspaces.find(
        (entry) => path.resolve(entry.path) === path.resolve(pin),
      );
      return toResolved(
        known ?? { id: idForPath(current, pin), path: path.resolve(pin) },
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
    if (known && isDirectory(known.path)) {
      return toResolved(known, false);
    }
    problems.push(
      `The active workspace "${current.active}" has no folder any more; opening the default workspace`,
    );
  }
  return fallback;
}

/** A registry id for a folder named from outside: its name, made unique. */
function idForPath(registry: WorkspaceRegistry, workspacePath: string) {
  const base =
    path
      .basename(workspacePath)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "workspace";
  let id = base;
  for (let n = 2; registry.workspaces.some((entry) => entry.id === id); n++) {
    id = `${base}-${n.toString()}`;
  }
  return id;
}

function isDirectory(dir: string) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The default workspace first, always at this userData's own folder whatever
 * the file says, and each folder listed once: a second entry for a folder
 * already listed (the default one under another id, say) would let it be
 * mistaken for a different workspace.
 */
function normalize(
  registry: WorkspaceRegistry,
  userDataDir: string,
): WorkspaceRegistry {
  const defaultEntry =
    registry.workspaces.find((entry) => entry.id === DEFAULT_WORKSPACE_ID) ??
    ({ id: DEFAULT_WORKSPACE_ID } satisfies Partial<RegistryEntry>);
  const seen = new Set<string>();
  const workspaces: RegistryEntry[] = [];
  const others = registry.workspaces.filter(
    (other) => other.id !== DEFAULT_WORKSPACE_ID,
  );
  for (const entry of [
    { ...defaultEntry, path: defaultWorkspacePath(userDataDir) },
    ...others,
  ]) {
    const key = path.resolve(entry.path);
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
        })),
      },
      userDataDir,
    ),
    unreadable,
  };
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

let resolvedWorkspace: OpenWorkspace | undefined;

/**
 * The workspace this process runs. Resolved once in `setup-environment.ts`; a
 * read before that would put a store in the wrong folder, so it throws instead.
 */
export function getResolvedWorkspace(): OpenWorkspace {
  if (!resolvedWorkspace) {
    throw new Error(
      "The workspace was read before setup-environment resolved it",
    );
  }
  return resolvedWorkspace;
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
 * `markDir` (its machine folder), if any.
 */
export function openElsewhereBy(markDir: string): null | number {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(openPidPath(markDir), "utf8").trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
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

export function setResolvedWorkspace(workspace: OpenWorkspace): void {
  resolvedWorkspace = workspace;
}

function openPidPath(markDir: string) {
  return path.join(markDir, WORKSPACE_MACHINE_ENTRIES.openMark);
}

/** The workspace folder a machine folder's record says it belongs to. */
function readOwner(
  userDataDir: string,
  machineDir: string,
): string | undefined {
  const parsed = z
    .object({ path: z.string().min(1) })
    .safeParse(
      readJson(path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.owner)),
    );
  return parsed.success
    ? path.resolve(userDataDir, parsed.data.path)
    : undefined;
}

function samePath(a: string, b: string) {
  return path.resolve(a) === path.resolve(b);
}

/**
 * Record which workspace folder a machine folder belongs to, relative to
 * userData when it is inside it, as the registry stores it, so a copied
 * application-data directory finds its own workspace there.
 */
function writeOwner(
  userDataDir: string,
  machineDir: string,
  workspacePath: string,
) {
  writeJsonAtomic(path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.owner), {
    path: storedPath(path.resolve(workspacePath), userDataDir),
  });
}
