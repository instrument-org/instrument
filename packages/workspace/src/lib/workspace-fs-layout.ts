import {
  type IFileSystem,
  InMemoryFs,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { CHAT_FOLDER_NAMES, TASKS_DIR_NAME } from "../constants";
import { type MountedFolder } from "../schemas/mounted-folder";
import { rulesFs } from "./permissions/rules-fs";
import { raiseAsk, waitingNote } from "./permissions/asks";
import { reachOf, type Rule, type Rules } from "./permissions/rules";
import { type AbsolutePath, type ChatDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import {
  canonicalizeThroughMissing,
  hostPathWithin,
  realRoot,
} from "./host-path";
import { type MaskedEntry, maskedEntryOf } from "./mask-private-dir-fs";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { ReadOnlyBaseFs } from "./read-only-base-fs";
import { chatsDir } from "./record-folders";
import { skillWriteTrackingFs } from "./skill-write-tracking-fs";
import { type WalkBudget } from "./walk-budget";
import { BUNDLED_SOURCE_IDS, getSkillSources } from "./skills";
import { getWorkspaceConfig } from "./workspace-config";
export { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Virtual mount point of the device files.
 *
 * Not part of the agent's working surface: it exists so the ordinary shell
 * idiom of redirecting output into a sink resolves instead of failing.
 */
const DEV_MOUNT_POINT = "/dev";

/**
 * The complete filesystem layout for a chat: the writable task mount (the
 * chat's folder), one mount per skill source, and the folders the chat
 * reaches, each writable unless it holds the workspace. Every mount sits at
 * its own host path in the shell's spelling. This is the single source of
 * truth shared by the bash sandbox (just-bash filesystem) and the dedicated
 * file tools, so both agree on what the agent can see and where.
 */
export interface WorkspaceFsLayout {
  /**
   * The workspace's own apps directory, writable, for the agent that authors
   * apps. Absent for a task, which reaches its apps through the `app` command.
   */
  apps?: WorkspaceFsMount & { readOnly: false };
  /** The folders the chat reaches. */
  folders: WorkspaceFsMount[];
  /**
   * What Settings › Permissions, the chat's grants and the app's own rules
   * allow inside those folders. Built with the layout, so every consumer
   * holds to the same rules.
   */
  rules: Rules;
  /**
   * One per skill source, at the source's own directory. The workspace's own
   * skills are writable because authoring one is editing a plain package of
   * files, and everything else -- what the app ships, and what a co-installed
   * agent left in its home directory -- is read-only where it was discovered.
   *
   * Listed whether or not the directory exists, because the layout is built
   * synchronously; `buildBashFs` skips the ones that are not there.
   */
  skills: WorkspaceFsMount[];
  task: WorkspaceFsMount & { hostRoot: ChatDir; readOnly: false };
}

/** A single mount in the workspace filesystem. */
export interface WorkspaceFsMount {
  /** Real on-disk directory backing this mount. */
  hostRoot: AbsolutePath;
  /**
   * Entries at this mount's root that are not the agent's to read or write,
   * and that every consumer of the layout has to refuse: the `.instrument`
   * dir, and in a chat's task mount its `tasks/` dir as well (see
   * {@link taskMaskedEntries}). Empty for a mount that masks nothing.
   *
   * A property of the mount rather than a case each consumer writes against the
   * task mount, because each mount that masks anything holds settings that
   * decide what the agent can reach, such as the chat's grants. A guard
   * spelled per consumer is one the next mount does not inherit.
   */
  maskedEntries: readonly MaskedEntry[];
  /** Absolute, normalized path in the shell's spelling where the directory appears. */
  mountPoint: string;
  /**
   * When true the mount is read-only: writes throw EROFS in the shell.
   * A folder is read-only when it holds the workspace
   * ({@link effectiveFolderAccess}).
   */
  readOnly: boolean;
}

/**
 * Build the just-bash filesystem the bash interpreter runs against, from the
 * layout: an empty read-only base holds the root (so stray writes like
 * /tmp/x fail loudly instead of evaporating with the per-call filesystem), the
 * task mounts writable at its mount point, and the chat's folders mount with
 * the access each gets.
 */
export async function buildBashFs(
  layout: WorkspaceFsLayout,
  {
    homeWalkBudget,
    maxFileReadSize,
    onRefusal,
  }: {
    /**
     * Counts listings under a folder that holds the workspace (the home
     * folder) against a budget of their own; see `WalkBudget`.
     */
    homeWalkBudget?: WalkBudget;
    maxFileReadSize: number;
    /** Hears each time the rules refuse the agent a path. */
    onRefusal?: (refusal: string) => void;
  },
): Promise<IFileSystem> {
  const { rules } = layout;
  /**
   * A path outside every mount that the person could allow: the nearest
   * folder on disk that holds it, asked for (never the home folder whole or
   * the disk root), with the refusal reported. Undefined for the system's own
   * folders, a lookup on the shell's PATH, a folder above a mount, and a
   * path nothing on disk holds.
   */
  const outsideFolder = (
    path: string,
    op: "read" | "write",
  ): string | undefined => {
    // The shell looking a command up on its PATH is not the agent asking,
    // and a folder above a mount answers as one, which a walk to the mount
    // looks at first.
    if (
      SHELL_PATH_DIRS.has(nodePath.posix.dirname(path)) ||
      allMounts(layout).some((mount) =>
        mount.mountPoint.startsWith(`${path === "/" ? "" : path}/`),
      )
    ) {
      return undefined;
    }
    const hostPath = hostPathOf(path);
    // The system's own folders are nothing to ask the person for.
    if (SYSTEM_FOLDERS.some((system) => pathIsWithin(hostPath, system))) {
      return undefined;
    }
    let folder = hostPath;
    if (op === "write") {
      // A file being made is not on disk yet; the folder it goes in is.
      while (!existsSync(folder) && folder !== nodePath.dirname(folder)) {
        folder = nodePath.dirname(folder);
      }
    }
    if (!existsSync(folder)) {
      return undefined;
    }
    if (!statSync(folder).isDirectory()) {
      folder = nodePath.dirname(folder);
    }
    if (
      rules.asker &&
      folder !== rules.home &&
      folder !== nodePath.parse(folder).root
    ) {
      raiseAsk(rules.asker, "folder", folder);
      onRefusal?.(waitingNote(shellPath(folder)));
    } else {
      onRefusal?.(`${path} is outside the folders you reach.`);
    }
    return folder;
  };

  // The rest of the disk is not mounted: the shell's own commands would find
  // host binaries on its PATH there. A read of a folder that exists outside
  // every mount is refused rather than missing, and says how to reach it.
  const fs = new MountableFs({
    base: new ReadOnlyBaseFs(
      (path) => (outsideFolder(path, "read") ? "refused" : undefined),
      (path) => {
        outsideFolder(path, "write");
      },
    ),
  });

  // just-bash seeds these into its default filesystem, but only for one it can
  // initialize itself -- a mounted layout gets no /dev, so `cmd > /dev/null`
  // dies with EROFS and takes the whole call's output with it. They are plain
  // writable files rather than real devices, which is enough for the
  // redirect-to-discard idiom; the mount is rebuilt per call, so anything
  // written here is dropped when the call ends.
  fs.mount(
    DEV_MOUNT_POINT,
    new InMemoryFs({
      null: "",
      stderr: "",
      stdin: "",
      stdout: "",
      zero: "",
    }),
  );

  // Every folder the agent reaches is mounted at its own path on the disk,
  // and a folder inside another is reached through the outer one, since a
  // mount cannot sit inside another. What the agent may read or change in
  // each is the rules' to say, the app's own folders included: its internals
  // are missing, the skills it ships are read-only, and the chat's folder is
  // open.
  const workspaceSkills = layout.skills.find((mount) => !mount.readOnly);
  for (const mount of await mountRoots(layout)) {
    const readOnly = mount.readOnly && !holdsWritable(layout, mount);
    let mounted: IFileSystem = readOnly
      ? new OverlayFs({
          maxFileReadSize,
          mountPoint: "/",
          readOnly: true,
          root: mount.hostRoot,
        })
      : new ReadWriteFs({ maxFileReadSize, root: mount.hostRoot });
    if (workspaceSkills) {
      const skillsWithin = hostPathWithin(
        mount.hostRoot,
        workspaceSkills.hostRoot,
      );
      if (skillsWithin !== null) {
        mounted = skillWriteTrackingFs(mounted, (path) =>
          skillsWithin === "/"
            ? normalizePath(path)
            : (relativeWithin(skillsWithin, normalizePath(path)) ?? undefined),
        );
      }
    }
    mounted = rulesFs({
      delegate: mounted,
      hostRoot: mount.hostRoot,
      onRefusal,
      rules,
      spell: (hostPath) => shellPath(hostPath),
    });
    fs.mount(
      mount.mountPoint,
      homeWalkBudget && folderHoldsWorkspace(mount.hostRoot)
        ? homeWalkBudget.wrap(mounted, mount.mountPoint, (path) => {
            // The chat's own folder walks at the sandbox's budget wherever
            // it sits, the home folder included.
            const inChat = hostPathWithin(
              layout.task.hostRoot,
              nodePath.join(mount.hostRoot, path),
            );
            return inChat !== null;
          })
        : mounted,
    );
  }

  return fs;
}

/**
 * Build the layout for a chat. Synchronous so the dedicated file tools can
 * resolve a path inline; bash's buildBashFs skips any folder that is missing
 * on disk at mount time.
 *
 * Not pure: a read-write folder is checked against the workspace root, which
 * reads the workspace config and canonicalizes both paths. A caller with no
 * config set can only build a layout whose folders are all read-only.
 */
export function buildWorkspaceFsLayout({
  apps = false,
  folders,
  rules,
  taskHostRoot,
}: {
  /** Whether the workspace's apps directory is mounted, writable. */
  apps?: boolean;
  folders?: Record<string, MountedFolder.Type>;
  rules?: Rules;
  taskHostRoot: ChatDir;
}): WorkspaceFsLayout {
  const mounts: WorkspaceFsMount[] = Object.values(folders ?? {}).map(
    (folder) => ({
      hostRoot: folder.path,
      // A folder on the user's disk is theirs, and an `.instrument` dir in it
      // is an ordinary directory of theirs rather than one of ours.
      maskedEntries: [],
      mountPoint: shellPath(folder.path),
      // What may change in it is the rules' to say.
      readOnly: false,
    }),
  );

  const layout: Omit<WorkspaceFsLayout, "rules"> & { rules?: Rules } = {
    ...(apps
      ? {
          apps: {
            hostRoot: getWorkspaceConfig().appsDir,
            // Ours rather than a task's, and it holds no
            // settings: an `.instrument` dir in it would be an ordinary one.
            maskedEntries: [],
            mountPoint: shellPath(getWorkspaceConfig().appsDir),
            readOnly: false as const,
          },
        }
      : {}),
    folders: mounts,
    ...(rules && { rules }),
    skills: buildSkillMounts(),
    task: {
      hostRoot: taskHostRoot,
      maskedEntries: taskMaskedEntries(taskHostRoot),
      mountPoint: shellPath(taskHostRoot),
      readOnly: false,
    },
  };
  // Every consumer of the layout (the shell, the file tools, the native
  // sandbox) holds to the same rules, the app's own over its folders among
  // them.
  return { ...layout, rules: layoutRules(layout) };
}

/**
 * The access a folder actually gets: read and write, unless the folder
 * overlaps the workspace's own directory in either direction.
 *
 * Every chat's database and settings, and the skills the agent loads as
 * instructions, live under the workspace root. A folder that contains it, or
 * sits inside it, would turn one chat's write grant into write access to
 * every other chat and a way to persist instructions across all of them.
 * Reading those files is possible through any such folder; writing them is
 * refused.
 *
 * The judgment is about the folder given, not about the mount it sits in: the
 * home folder whole is read-only, since the workspace is somewhere inside it,
 * while its Desktop granted on its own is clear of the workspace and carries
 * the grant in full.
 *
 * Applied here rather than at the UI so it holds for a hand-edited
 * settings.json, and shared with the agent's folder list so what the model is
 * told matches what the filesystem enforces.
 *
 * Both paths are canonicalized before they are compared, because the overlap
 * is a fact about the directory rather than about how it was spelled: `..`
 * segments and a symlink pointing at the workspace both name it without
 * matching it as a prefix. Only a read-write grant pays for that, so the usual
 * read-only folder costs nothing.
 */
export function effectiveFolderAccess(folder: {
  access: MountedFolder.Access;
  path: string;
}): MountedFolder.Access {
  if (folder.access !== "read-write") {
    return "read-only";
  }
  const folderPath = canonicalizeThroughMissing(folder.path);
  const workspaceRoot = canonicalizeThroughMissing(
    getWorkspaceConfig().rootDir,
  );
  // Either path failing to resolve means the overlap cannot be ruled out, so
  // the grant is refused rather than assumed safe.
  if (folderPath === null || workspaceRoot === null) {
    return "read-only";
  }
  const overlapsWorkspace =
    pathIsWithin(folderPath, workspaceRoot) ||
    pathIsWithin(workspaceRoot, folderPath);
  return overlapsWorkspace ? "read-only" : "read-write";
}

/**
 * True when a folder contains the workspace root: the home folder, reached
 * whole. Such a folder is read-only as a whole (effectiveFolderAccess) while a
 * folder inside it takes a write grant, which is what a refusal to write it
 * whole should say to do instead.
 */
export function folderHoldsWorkspace(folderPath: string): boolean {
  const resolved = canonicalizeThroughMissing(folderPath);
  const workspaceRoot = canonicalizeThroughMissing(
    getWorkspaceConfig().rootDir,
  );
  return (
    resolved !== null &&
    workspaceRoot !== null &&
    resolved !== workspaceRoot &&
    pathIsWithin(workspaceRoot, resolved)
  );
}

/** Every mount other than the task, in the order they are advertised. */
export function nonTaskMounts(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [
    ...layout.folders,
    ...layout.skills,
    ...(layout.apps ? [layout.apps] : []),
  ];
}

/** Mount point of the masked-off private dir under the task mount. */
export function privateMountPoint(taskMountPoint: string): string {
  return `${taskMountPoint}/${CHAT_FOLDER_NAMES.private}`;
}

/**
 * Resolve an absolute path in the shell's spelling to the real on-disk path
 * that backs it, plus the mount that owns it. Returns null if no mount owns
 * the path. The longest matching mount point wins, so a folder mount inside
 * the task mount's folder takes precedence over it.
 */
export function resolveHostPath(
  layout: WorkspaceFsLayout,
  virtualAbsPath: string,
): null | { hostPath: AbsolutePath; mount: WorkspaceFsMount } {
  const normalized = normalizePath(virtualAbsPath);

  let best: null | { mount: WorkspaceFsMount; relative: string } = null;
  for (const mount of allMounts(layout)) {
    const relative = relativeWithin(mount.mountPoint, normalized);
    if (relative === null) {
      continue;
    }
    if (
      best === null ||
      mount.mountPoint.length > best.mount.mountPoint.length
    ) {
      best = { mount, relative };
    }
  }

  if (best === null) {
    return null;
  }

  const relativeSegment = best.relative === "/" ? "." : `.${best.relative}`;
  return {
    hostPath: absolutePathJoin(best.mount.hostRoot, relativeSegment),
    mount: best.mount,
  };
}

/**
 * Map a shell path to a host path for a native binary that can only READ.
 *
 * This resolves the whole layout, including the folders the chat reaches and
 * the skills. That is the point: a search command the user cannot point at
 * their folders is not worth having, and the dedicated grep tool already hands
 * real ripgrep those same host paths.
 *
 * The safety of the wider reach rests entirely on the caller, which MUST
 * reject every flag that lets the binary write or execute (for ripgrep:
 * `--pre`, `--pre-glob`, `--hostname-bin`, `-z`/`--search-zip`).
 *
 * Returns null for a path outside every mount, for a masked entry, and for a
 * symlink that resolves out of its own mount, so the caller reports a clean
 * error rather than reaching the host.
 */
export function resolveReadOnlyHostPath(
  layout: WorkspaceFsLayout,
  virtualAbsPath: string,
): AbsolutePath | null {
  const resolved = resolveHostPath(layout, virtualAbsPath);
  if (resolved === null) {
    return null;
  }
  const found = classifyHostPath(layout, resolved.hostPath, resolved.mount);
  // The bash sandbox refuses to traverse a symlink out of a mount; a real
  // binary would happily follow it, so the containment has to be re-checked
  // here rather than inherited. Not asked of the task mount, whose own contents
  // the agent writes and reads by relative path in any case.
  // Nor do the rules reach a real binary on every platform, so a place they
  // keep closed or ask about is refused here too.
  return found === null ||
    found.masked !== undefined ||
    (resolved.mount !== layout.task && found.escapes) ||
    reachOf(layout.rules, resolved.hostPath, "read").level !== "allow"
    ? null
    : resolved.hostPath;
}

/**
 * {@link classifyHostPath} for a shell path, through the mount that owns
 * it. Null for a path no mount owns.
 */
export function classifyVirtualPath(
  layout: WorkspaceFsLayout,
  virtualAbsPath: string,
): ReturnType<typeof classifyHostPath> {
  const resolved = resolveHostPath(layout, virtualAbsPath);
  return resolved === null
    ? null
    : classifyHostPath(layout, resolved.hostPath, resolved.mount);
}

/**
 * What a path on the disk is to the agent: the mount it is reached through
 * and its path there, the masked entry it is or is inside, and whether it
 * leaves that mount through a symlink. Null when no mount holds it.
 *
 * The one place these are answered, for every consumer that holds a host
 * path: the file tools, the native hatches that reach mounts (`rg`, `du`,
 * `git`), and the agent's browser. The path is canonicalized once (through a
 * symlink, through missing segments, and without case on a disk that ignores
 * it), so two spellings of one file get one answer.
 *
 * `via` is the mount the path was reached through, when the caller resolved a
 * shell path to get it; without one the deepest mount holding the path is
 * taken, by its spelling first and by where it really leads after.
 *
 * Masked is asked of the mount the path is reached through, by its path
 * there, and of the deepest mount whose real root holds where the path really
 * leads, by its path there. So a task's private dir is masked however the
 * agent reached it, a chat's `tasks/` dir is masked from its own folder, and
 * each task inside it answers for its own private dir alone.
 */
export function classifyHostPath(
  layout: WorkspaceFsLayout,
  hostPath: string,
  via?: WorkspaceFsMount,
): null | {
  escapes: boolean;
  masked: MaskedEntry | undefined;
  mount: WorkspaceFsMount;
  virtualPath: string;
} {
  const mounts = allMounts(layout);
  const canonical = canonicalizeThroughMissing(hostPath);
  const realRoots = new Map(
    mounts.map((mount) => [mount, realRoot(mount.hostRoot)]),
  );
  const held = (
    candidates: WorkspaceFsMount[],
    rootOf: (mount: WorkspaceFsMount) => null | string,
    target: null | string,
  ) => {
    let best: null | { mount: WorkspaceFsMount; relative: string } = null;
    let bestRoot = "";
    for (const mount of candidates) {
      const root = rootOf(mount);
      const relative =
        root === null || target === null ? null : hostPathWithin(root, target);
      if (relative !== null && root !== null && root.length > bestRoot.length) {
        best = { mount, relative };
        bestRoot = root;
      }
    }
    return best;
  };
  const lexical = held(
    via ? [via] : mounts,
    (mount) => mount.hostRoot,
    hostPath,
  );
  const reached =
    lexical ??
    (via
      ? null
      : held(mounts, (mount) => realRoots.get(mount) ?? null, canonical));
  if (reached === null) {
    return null;
  }
  const real = held(mounts, (mount) => realRoots.get(mount) ?? null, canonical);
  const ownRoot = realRoots.get(reached.mount);
  return {
    // A path or a root that cannot be resolved cannot be shown to stay inside,
    // so it is taken to leave; a mount whose root is gone holds nothing to
    // leave from.
    escapes:
      canonical === null ||
      ownRoot === null ||
      (ownRoot !== undefined && hostPathWithin(ownRoot, canonical) === null),
    masked:
      maskedEntryOf(reached.relative, reached.mount.maskedEntries) ??
      (real
        ? maskedEntryOf(real.relative, real.mount.maskedEntries)
        : undefined),
    mount: reached.mount,
    virtualPath: normalizePath(
      reached.relative === "/"
        ? reached.mount.mountPoint
        : `${reached.mount.mountPoint}${reached.relative}`,
    ),
  };
}

/** All mounts, task first. */
function allMounts(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [layout.task, ...nonTaskMounts(layout)];
}

/**
 * One mount per skill source, at the source's own directory.
 *
 * Derived from the same source list discovery walks, so a source the agent can
 * load a skill from is a source it can also read and run that skill's files in.
 * The two bundled sources collapse onto one segment backed by the prepared
 * directory: they cannot run from the app bundle, which is signed and replaced
 * wholesale by the updater, so they are materialized once per machine instead.
 */
function buildSkillMounts(): WorkspaceFsMount[] {
  const config = getWorkspaceConfig();
  const mounts = new Map<string, WorkspaceFsMount>();

  for (const { dir, id } of getSkillSources(config)) {
    const bundled = BUNDLED_SOURCE_IDS.has(id);
    const hostRoot = bundled ? config.preparedSkillsDir : dir;
    // Both bundled ids reach the prepared directory, and the first one to
    // claim it stands for both.
    if (mounts.has(hostRoot)) {
      continue;
    }
    const mountPoint = shellPath(hostRoot);
    mounts.set(hostRoot, {
      hostRoot,
      // Every one of these belongs to a tool rather than to a task,
      // so an `.instrument` dir in one is an ordinary directory of theirs.
      maskedEntries: [],
      mountPoint,
      readOnly: id !== "workspace",
    });
  }

  return [...mounts.values()];
}

/**
 * What the task mount masks: its private dir, and in a chat's own folder the
 * `tasks/` dir an earlier version kept its tasks in. The chat's folder mounts
 * writable, so without this those old folders would sit under it at
 * `tasks/<id>`, writable and with their private dirs in plain view.
 * Decided by where the folder is rather than by an id so that it holds for
 * every consumer handed only the task's host root.
 */
function taskMaskedEntries(taskHostRoot: ChatDir): MaskedEntry[] {
  return nodePath.dirname(taskHostRoot) === chatsDir()
    ? [CHAT_FOLDER_NAMES.private, TASKS_DIR_NAME]
    : [CHAT_FOLDER_NAMES.private];
}

/**
 * The shell's PATH: system folders it does not mount, so a command lookup
 * falls to the shell's own commands rather than a host binary.
 */
export const SHELL_PATH = "/usr/local/bin:/usr/bin:/bin";
const SHELL_PATH_DIRS = new Set(SHELL_PATH.split(":"));

/** Folders that hold the system rather than anything of the person's. */
const SYSTEM_FOLDERS = [
  "/System",
  "/Library",
  "/Applications",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/private/etc",
  "/opt",
  "/dev",
  "/proc",
  "/sys",
];

/**
 * The path the agent's shell names a host path by. The same path on macOS
 * and Linux; on Windows, the drive-letter spelling Git Bash uses
 * (`/c/Users/sam`), since the shell is POSIX.
 */
export function shellPath(hostPath: string): string {
  if (process.platform !== "win32") {
    return hostPath;
  }
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(hostPath);
  return drive
    ? `/${(drive[1] ?? "").toLowerCase()}/${(drive[2] ?? "").replaceAll("\\", "/")}`.replace(
        /\/$/,
        "",
      )
    : hostPath.replaceAll("\\", "/");
}

/**
 * The host path a shell path names: the inverse of {@link shellPath}. The same
 * path on macOS and Linux; on Windows `/c/Users/sam` becomes `C:\Users\sam`.
 */
export function hostPathOf(shellSpelled: string): string {
  if (process.platform !== "win32") {
    return shellSpelled;
  }
  const drive = /^\/([A-Za-z])(?:\/(.*))?$/.exec(shellSpelled);
  return drive
    ? `${(drive[1] ?? "").toUpperCase()}:\\${(drive[2] ?? "").replaceAll("/", "\\")}`
    : shellSpelled.replaceAll("/", "\\");
}

/**
 * The rules the layout is held to: the chat's, or where none were given an
 * allow for each folder it reaches, plus the app's own over its folders. The
 * workspace is missing to the agent but for the chat's folder, the skills it
 * reads and the apps it writes; the chat's internals are missing inside it.
 */
function layoutRules(
  layout: Omit<WorkspaceFsLayout, "rules"> & { rules?: Rules },
): Rules {
  const given: Rules = layout.rules ?? {
    home: os.homedir(),
    rules: layout.folders.map((mount) => ({
      level: "allow",
      path: mount.hostRoot,
      source: "grant",
    })),
    withoutAsking: false,
  };
  const system = (level: Rule["level"], path: string): Rule => ({
    level,
    path,
    source: "system",
  });
  const own: Rule[] = [
    system("hidden", getWorkspaceConfig().rootDir),
    system("allow", layout.task.hostRoot),
    ...layout.task.maskedEntries.map((entry) =>
      system("hidden", nodePath.join(layout.task.hostRoot, entry)),
    ),
    ...layout.skills.map((mount) =>
      system(mount.readOnly ? "readOnly" : "allow", mount.hostRoot),
    ),
    ...(layout.apps ? [system("allow", layout.apps.hostRoot)] : []),
  ];
  return { ...given, rules: [...given.rules, ...own] };
}

/** The layout's mounts with every one inside another left to the outer. */
async function mountRoots(
  layout: WorkspaceFsLayout,
): Promise<WorkspaceFsMount[]> {
  const present: WorkspaceFsMount[] = [];
  // The app's own folders are made when missing; a folder of the person's
  // that is gone stays gone rather than coming back empty.
  const ours = [
    layout.task,
    ...layout.skills.filter((mount) => !mount.readOnly),
    ...(layout.apps ? [layout.apps] : []),
  ];
  for (const mount of allMounts(layout)) {
    if (ours.includes(mount)) {
      await mkdir(mount.hostRoot, { recursive: true }).catch(() => undefined);
    }
    if (await pathExists(mount.hostRoot)) {
      present.push(mount);
    }
  }
  const outermost = present.toSorted(
    (a, b) => a.hostRoot.length - b.hostRoot.length,
  );
  const roots: WorkspaceFsMount[] = [];
  for (const mount of outermost) {
    if (!roots.some((root) => hostPathWithin(root.hostRoot, mount.hostRoot))) {
      roots.push(mount);
    }
  }
  return roots;
}

/** Whether a read-only mount holds one the agent writes, which it reaches through it. */
function holdsWritable(
  layout: WorkspaceFsLayout,
  outer: WorkspaceFsMount,
): boolean {
  return allMounts(layout).some(
    (mount) =>
      mount !== outer &&
      !mount.readOnly &&
      hostPathWithin(outer.hostRoot, mount.hostRoot) !== null,
  );
}
