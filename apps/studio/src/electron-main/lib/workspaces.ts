import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Which workspace folder this process runs, out of the ones this machine knows.
 *
 * A workspace is a folder: chats, tasks, and the rest at the top level, and
 * what the app keeps for it under `.instrument/` (its database, its settings
 * stores, its Chromium profiles). The machine keeps a list of them in
 * `workspaces.json` at the root of userData, with the one to open next.
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

const REGISTRY_FILENAME = "workspaces.json";
const IDENTITY_FILENAME = "workspace.json";
const OPEN_PID_FILENAME = "open.pid";

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
  workspaces: z.array(RegistryEntrySchema).catch([]),
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

export function workspacePrivateDir(workspacePath: string): string {
  return path.join(workspacePath, TASK_PRIVATE_FOLDER_NAME);
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

let resolvedWorkspace: ResolvedWorkspace | undefined;

/**
 * The workspace this process runs. Resolved once in `setup-environment.ts`; a
 * read before that would put a store in the wrong folder, so it throws instead.
 */
export function getResolvedWorkspace(): ResolvedWorkspace {
  if (!resolvedWorkspace) {
    throw new Error(
      "The workspace was read before setup-environment resolved it",
    );
  }
  return resolvedWorkspace;
}

/**
 * Mark the workspace open in this process, until `releaseOpenMark`. Advisory:
 * it does not stop a second process opening the same workspace (worktrees
 * share the default one), only a delete from under a running one.
 */
export function markWorkspaceOpen(workspacePath: string): void {
  // A live process already holding it keeps its mark: a second process (a
  // single-instance lock loser on its way out, a second worktree) would
  // otherwise take the mark and then remove it on exit.
  if (openElsewhereBy(workspacePath) !== null) {
    return;
  }
  try {
    fs.mkdirSync(workspacePrivateDir(workspacePath), { recursive: true });
    fs.writeFileSync(openPidPath(workspacePath), process.pid.toString());
  } catch {
    // Advisory; a workspace that cannot be marked still opens.
  }
}

/** The pid of another live process holding the workspace open, if any. */
export function openElsewhereBy(workspacePath: string): null | number {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(openPidPath(workspacePath), "utf8").trim());
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

export function releaseOpenMark(workspacePath: string): void {
  try {
    if (
      fs.readFileSync(openPidPath(workspacePath), "utf8").trim() ===
      process.pid.toString()
    ) {
      fs.rmSync(openPidPath(workspacePath));
    }
  } catch {
    // Already gone, or another process took it over.
  }
}

export function setResolvedWorkspace(workspace: ResolvedWorkspace): void {
  resolvedWorkspace = workspace;
}

function openPidPath(workspacePath: string) {
  return path.join(workspacePrivateDir(workspacePath), OPEN_PID_FILENAME);
}
