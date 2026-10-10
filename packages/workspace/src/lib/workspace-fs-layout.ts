import {
  type IFileSystem,
  InMemoryFs,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";
import { mkdir } from "node:fs/promises";
import nodePath from "node:path";

import { CHAT_FOLDER_NAMES, TASKS_DIR_NAME } from "../constants";
import { MOUNT } from "../mount-points";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type ChatDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import {
  canonicalizeThroughMissing,
  hostPathWithin,
  realRoot,
} from "./host-path";
import { assignAttachedMounts } from "./attached-folder-mounts";
import {
  type MaskedEntry,
  maskedEntryOf,
  maskPrivateDirFs,
} from "./mask-private-dir-fs";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { ReadOnlyBaseFs } from "./read-only-base-fs";
import { chatsDir } from "./record-folders";
import { skillWriteTrackingFs } from "./skill-write-tracking-fs";
import { type WalkBudget } from "./walk-budget";
import {
  BUNDLED_SOURCE_IDS,
  getSkillSources,
  skillsMountSegment,
} from "./skills";
import { getWorkspaceConfig } from "./workspace-config";
export { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Virtual mount point of the writable task directory.
 *
 * The task is mounted under a named home (`/task`) rather than the filesystem
 * root so the agent has a clear, stable place to work and is less prone to
 * hallucinating host paths. Relative paths (work/, attachments/, ...)
 * are unaffected since the working directory is this mount. Every virtual<->real
 * translator routes through the layout, so this is the single value to change.
 */

/**
 * Virtual mount point of the device files.
 *
 * Not part of the agent's working surface: it exists so the ordinary shell
 * idiom of redirecting output into a sink resolves instead of failing.
 */
const DEV_MOUNT_POINT = "/dev";

/**
 * The `/dev` entries a real subprocess may receive verbatim in its argv.
 *
 * These are host character devices, not virtual paths, so quarantining them
 * protects nothing: they hold no user data, name no part of the machine's
 * layout, and a subprocess can already open any of them from inside inline
 * code or a script file, neither of which is rewritten. What the quarantine
 * does catch is the standard idiom -- `ffmpeg -pass 1 -f mp4 /dev/null`,
 * `python /dev/stdin` -- which fails with a not-found error naming a path the
 * agent never wrote.
 *
 * Exact names only. A `/dev/` prefix rule would also admit `/dev/disk0`,
 * `/dev/rdisk0`, and `/dev/fd/<n>`, which are raw devices and other processes'
 * descriptors; those stay quarantined.
 */
const HOST_DEVICE_NAMES = new Set([
  "null",
  "random",
  "stderr",
  "stdin",
  "stdout",
  "urandom",
  "zero",
]);

/**
 * The complete virtual filesystem layout for a task: the writable task mount,
 * one mount per skill source, and any user-attached folders, each read-only or
 * writable according to the access the user granted it. This is the single
 * source of truth shared by the bash sandbox (just-bash filesystem), the
 * native-binary path bridge, and the dedicated file tools, so all three agree
 * on what the agent can see and where.
 */
export interface WorkspaceFsLayout {
  /**
   * The workspace's own apps directory, writable, for the agent that authors
   * apps. Absent for a task, which reaches its apps through the `app` command.
   */
  apps?: WorkspaceFsMount & { readOnly: false };
  attached: WorkspaceFsMount[];
  /**
   * One per skill source, at `/skills/<source>/`. The source segment is what
   * carries provenance and writability, so the agent reads both off the path
   * rather than having to ask: the workspace's own skills are writable because
   * authoring one is editing a plain package of files, and everything else --
   * what the app ships, and what a co-installed agent left in its home
   * directory -- is read-only where it was discovered.
   *
   * Listed whether or not the directory exists, because the layout is built
   * synchronously; `buildBashFs` skips the ones that are not there.
   */
  skills: WorkspaceFsMount[];
  task: WorkspaceFsMount & { hostRoot: ChatDir; readOnly: false };
}

/** A single virtual->real mount in the workspace filesystem. */
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
   * decide what the agent can reach, such as the task's attached folders. A
   * guard spelled per consumer is one the next mount does not inherit.
   */
  maskedEntries: readonly MaskedEntry[];
  /** Absolute, normalized virtual path where the directory appears. */
  mountPoint: string;
  /**
   * When true the mount is read-only: writes throw EROFS in the virtual FS.
   * Attached folders are read-only unless the user granted the task read-write
   * access to them.
   *
   * Independently of this flag, no attached folder's host path is handed to a
   * real native binary; see {@link resolveNativeHostPath}.
   */
  readOnly: boolean;
}

/**
 * Build the just-bash filesystem the bash interpreter runs against, from the
 * layout: an empty read-only base holds the virtual root (so stray writes like
 * /tmp/x fail loudly instead of evaporating with the per-call filesystem), the
 * task mounts writable at its mount point, and attached folders mount with the
 * access the user granted them.
 */
export async function buildBashFs(
  layout: WorkspaceFsLayout,
  {
    homeWalkBudget,
    maxFileReadSize,
  }: {
    /**
     * Counts listings under a folder that holds the workspace (the home
     * folder) against a budget of their own; see `WalkBudget`.
     */
    homeWalkBudget?: WalkBudget;
    maxFileReadSize: number;
  },
): Promise<IFileSystem> {
  const fs = new MountableFs({ base: new ReadOnlyBaseFs() });

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

  // The task mount is wrapped so the private dir is masked from the agent's
  // shell. It holds task internals the agent must never read: the task db,
  // state.json (attached-folder host paths), and settings. The app reads these
  // through real fs, not this virtual FS, so the mask is agent-only. Agent-
  // facing byproducts (screenshots, tool-output) deliberately live under work/,
  // never here.
  fs.mount(
    layout.task.mountPoint,
    masked(
      layout.task,
      new ReadWriteFs({ maxFileReadSize, root: layout.task.hostRoot }),
    ),
  );

  for (const mount of layout.attached) {
    // Folders can be detached or deleted on disk between turns; both filesystems
    // throw if their root is missing, so skip any that no longer exist.
    if (!(await pathExists(mount.hostRoot))) {
      continue;
    }
    // A writable folder has to mount through ReadWriteFs, the same filesystem
    // the task mount uses, because it is the only one that writes to disk.
    // OverlayFs is copy-on-write into memory, and the filesystem is rebuilt per
    // bash call, so mounting a writable folder there would report every `mv`
    // and `cp` as succeeding and leave the user's files untouched.
    const mounted = masked(
      mount,
      mount.readOnly
        ? new OverlayFs({
            maxFileReadSize,
            mountPoint: "/",
            readOnly: true,
            root: mount.hostRoot,
          })
        : new ReadWriteFs({ maxFileReadSize, root: mount.hostRoot }),
    );
    fs.mount(
      mount.mountPoint,
      homeWalkBudget && folderHoldsWorkspace(mount.hostRoot)
        ? homeWalkBudget.wrap(mounted, mount.mountPoint)
        : mounted,
    );
  }

  for (const mount of layout.skills) {
    // The workspace's own directory is always meant to be there, so create it if
    // a fresh workspace has not yet: skipping it would leave the agent writing
    // to a path the prompt advertises but that does not exist. Every other
    // source belongs to something else on this machine, and an absent one just
    // means that tool is not installed.
    if (mount.readOnly) {
      if (!(await pathExists(mount.hostRoot))) {
        continue;
      }
      fs.mount(
        mount.mountPoint,
        new OverlayFs({
          maxFileReadSize,
          mountPoint: "/",
          readOnly: true,
          root: mount.hostRoot,
        }),
      );
      continue;
    }
    await mkdir(mount.hostRoot, { recursive: true });
    fs.mount(
      mount.mountPoint,
      skillWriteTrackingFs(
        new ReadWriteFs({ maxFileReadSize, root: mount.hostRoot }),
      ),
    );
  }

  // The apps directory is created on demand for the same reason the skills
  // one is: the prompt advertises it before the first app is written.
  if (layout.apps) {
    await mkdir(layout.apps.hostRoot, { recursive: true });
    fs.mount(
      layout.apps.mountPoint,
      new ReadWriteFs({ maxFileReadSize, root: layout.apps.hostRoot }),
    );
  }

  return fs;
}

/**
 * Build the layout for a task. Synchronous so the dedicated file tools can
 * resolve a path inline; bash's buildBashFs skips any attached folder that is
 * missing on disk at mount time.
 *
 * Not pure: a read-write folder is checked against the workspace root, which
 * reads the workspace config and canonicalizes both paths. A caller with no
 * config set can only build a layout whose folders are all read-only.
 */
export function buildWorkspaceFsLayout({
  apps = false,
  attachedFolders,
  extraMounts = [],
  taskHostRoot,
}: {
  /** Whether the workspace's apps directory is mounted, writable, at `/apps`. */
  apps?: boolean;
  attachedFolders?: Record<string, FolderAttachment.Type>;
  /**
   * Mounts the caller adds beside the attached folders, already resolved: an
   * chat's read-only view of the tasks it created. They are attached
   * mounts in every way that matters to the filesystem, so they take the same
   * masking and containment.
   */
  extraMounts?: WorkspaceFsMount[];
  taskHostRoot: ChatDir;
}): WorkspaceFsLayout {
  const attached: WorkspaceFsMount[] = [
    ...assignAttachedMounts(attachedFolders ?? {}).map(
      ({ folder, mountPoint }) => ({
        hostRoot: folder.path,
        // A folder the user attached is theirs, and an `.instrument` dir in it
        // is an ordinary directory of theirs rather than one of ours.
        maskedEntries: [],
        mountPoint,
        readOnly: effectiveFolderAccess(folder) !== "read-write",
      }),
    ),
    ...extraMounts,
  ];

  return {
    ...(apps
      ? {
          apps: {
            hostRoot: getWorkspaceConfig().appsDir,
            // Ours rather than a task's, and it holds no
            // settings: an `.instrument` dir in it would be an ordinary one.
            maskedEntries: [],
            mountPoint: MOUNT.apps,
            readOnly: false as const,
          },
        }
      : {}),
    attached,
    skills: buildSkillMounts(),
    task: {
      hostRoot: taskHostRoot,
      maskedEntries: taskMaskedEntries(taskHostRoot),
      mountPoint: MOUNT.task,
      readOnly: false,
    },
  };
}

/**
 * The access a folder actually gets: what the user granted, unless the folder
 * overlaps the workspace's own directory in either direction.
 *
 * Every task's database and state, and the skills
 * the agent loads as instructions live under the workspace root. A folder that
 * contains it, or sits inside it, would turn one task's write grant into write
 * access to every other task and a way to persist instructions across all of
 * them. Reading those files was already possible for anyone who attached such
 * a folder; writing them is refused.
 *
 * The judgment is about the folder given, not about the attachment it came
 * from: the home folder attached whole is read-only, since the workspace is
 * somewhere inside it, while its Desktop handed on its own is clear of the
 * workspace and carries the same grant in full.
 *
 * Applied here rather than at the UI so it holds for a hand-edited state.json,
 * and shared with the agent's folder list so what the model is told matches
 * what the filesystem enforces.
 *
 * Both paths are canonicalized before they are compared, because the overlap
 * is a fact about the directory rather than about how it was spelled: `..`
 * segments and a symlink pointing at the workspace both name it without
 * matching it as a prefix. Only a read-write grant pays for that, so the usual
 * read-only folder costs nothing.
 */
export function effectiveFolderAccess(folder: {
  access: FolderAttachment.Access;
  path: string;
}): FolderAttachment.Access {
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
 * True when a folder contains the workspace root: the home folder attached
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
    ...layout.attached,
    ...layout.skills,
    ...(layout.apps ? [layout.apps] : []),
  ];
}

/** Virtual mount point of the masked-off private dir under the task mount. */
export function privateMountPoint(taskMountPoint: string): string {
  return `${taskMountPoint}/${CHAT_FOLDER_NAMES.private}`;
}

/**
 * The host spelling of a device path a native binary may receive, or undefined
 * for every other path, which the caller quarantines as usual.
 *
 * Windows has no `/dev`; `NUL` is the only one of these with an equivalent, and
 * it is spelled as a device namespace path so it stays absolute.
 */
export function resolveHostDevicePath(
  virtualAbsPath: string,
): string | undefined {
  const relative = relativeWithin(
    DEV_MOUNT_POINT,
    normalizePath(virtualAbsPath),
  );
  const name = relative?.slice(1);
  if (name === undefined || !HOST_DEVICE_NAMES.has(name)) {
    return undefined;
  }
  if (process.platform === "win32") {
    return name === "null" ? String.raw`\\.\NUL` : undefined;
  }
  return `${DEV_MOUNT_POINT}/${name}`;
}

/**
 * Resolve a virtual absolute path to the real on-disk path that backs it, plus
 * the mount that owns it. Returns null if no mount owns the path. The longest
 * matching mount point wins, so an attached folder under /mnt takes precedence
 * over the task mount.
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
 * Map a virtual absolute path to the host path a NATIVE binary may receive.
 *
 * Native binaries (ffmpeg, python, node, ...) run against the real filesystem,
 * so this is the sandbox's outer boundary and it bridges the task mount and
 * nothing else. Every other virtual path quarantines to a path inside the task
 * dir that does not exist, so the binary fails with a not-found error instead
 * of touching the host.
 *
 * That holds for /mnt mounts the user granted write access to, not just the
 * read-only ones. A real host path is read AND write to the operating system,
 * so handing one to a subprocess would put the user's folder outside every
 * containment the sandbox has: no symlink check, no path masking, and no way
 * to tell what a build step touched. The agent copies a file into the task and
 * works on the copy instead. Writes back into the folder go through the virtual
 * filesystem, where the symlink check and the mount's access level still apply.
 * A skill's scripts are no exception: they run from the copy loading the skill
 * puts under the task's `work/skills/`.
 */
export function resolveNativeHostPath(
  taskHostRoot: ChatDir,
  virtualAbsPath: string,
): AbsolutePath {
  const normalized = normalizePath(virtualAbsPath);
  const relative = relativeWithin(MOUNT.task, normalized);
  if (
    relative !== null &&
    maskedEntryOf(relative, taskMaskedEntries(taskHostRoot)) === undefined
  ) {
    return absolutePathJoin(
      taskHostRoot,
      relative === "/" ? "." : `.${relative}`,
    );
  }
  // Masked paths (and any non-/task virtual path) quarantine to a
  // non-existent path inside the task dir -- same defense as the read-only /mnt
  // mounts: a native binary must never receive a real path into chat.db,
  // state.json, or settings, or into a chat's tasks, so it fails not-found
  // instead of reaching them.
  return absolutePathJoin(taskHostRoot, normalized);
}

/**
 * Map a virtual path to a host path for a native binary that can only READ.
 *
 * Unlike `resolveNativeHostPath` this resolves the whole layout, including the
 * `/mnt` mounts and `/skills`. That is the point: a search command
 * the user cannot point at their attached folders is not worth having, and the
 * dedicated grep tool already hands real ripgrep those same host paths.
 *
 * The safety of the wider reach rests entirely on the caller, which MUST:
 * - reject every flag that lets the binary write or execute (for ripgrep:
 *   `--pre`, `--pre-glob`, `--hostname-bin`, `-z`/`--search-zip`), and
 * - map every mount's host root back to its mount point in the binary's output,
 *   so the machine layout does not leak through match paths.
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
  return found === null ||
    found.masked !== undefined ||
    (resolved.mount !== layout.task && found.escapes)
    ? null
    : resolved.hostPath;
}

/**
 * {@link classifyHostPath} for a virtual path, through the mount that owns
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
 * virtual path to get it; without one the deepest mount holding the path is
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
 * One mount per skill source, at `/skills/<source>/`.
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
    const mountPoint = `${MOUNT.skills}/${skillsMountSegment(id)}`;
    // Both bundled ids reach the same segment, and the first one to claim it
    // brings the prepared directory with it.
    if (mounts.has(mountPoint)) {
      continue;
    }
    const bundled = BUNDLED_SOURCE_IDS.has(id);
    mounts.set(mountPoint, {
      hostRoot: bundled ? config.preparedSkillsDir : dir,
      // Every one of these belongs to a tool rather than to a task,
      // so an `.instrument` dir in one is an ordinary directory of theirs.
      maskedEntries: [],
      mountPoint,
      readOnly: id !== "workspace",
    });
  }

  return [...mounts.values()];
}

/** A mount's filesystem with its masked entries hidden, when it has any. */
function masked(mount: WorkspaceFsMount, fs: IFileSystem): IFileSystem {
  return mount.maskedEntries.length > 0
    ? maskPrivateDirFs(fs, mount.maskedEntries)
    : fs;
}

/**
 * What the task mount masks: its private dir, and in a chat's own folder the
 * `tasks/` dir an earlier version kept its tasks in. The chat's folder mounts
 * writable at `/task`, so without this those old folders would sit at
 * `/task/tasks/<id>`, writable and with their private dirs in plain view.
 * Decided by where the folder is rather than by an id so that it holds for
 * every consumer handed only the task's host root.
 */
function taskMaskedEntries(taskHostRoot: ChatDir): MaskedEntry[] {
  return nodePath.dirname(taskHostRoot) === chatsDir()
    ? [CHAT_FOLDER_NAMES.private, TASKS_DIR_NAME]
    : [CHAT_FOLDER_NAMES.private];
}
