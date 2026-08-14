import {
  type IFileSystem,
  InMemoryFs,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import nodePath from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { MOUNT } from "../mount-points";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { assignAttachedMounts } from "./attached-folder-mounts";
import { isPrivateRelative, maskPrivateDirFs } from "./mask-private-dir-fs";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { ReadOnlyBaseFs } from "./read-only-base-fs";
import { skillWriteTrackingFs } from "./skill-write-tracking-fs";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

export { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Virtual mount point of the writable task directory.
 *
 * The task is mounted under a named home (`/task`) rather than the filesystem
 * root so the agent has a clear, stable place to work and is less prone to
 * hallucinating host paths. Relative paths (work/, output/, attachments/, ...)
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
 * Virtual mount point of the workspace's own `skills/` directory.
 *
 * Always writable, whatever access the attached folders have: authoring a skill
 * is editing a plain package of files, so the agent does it with the ordinary
 * file tools rather than a dedicated tool. Only the workspace's skills live
 * here -- skills
 * discovered in a co-installed agent's home directory stay readable through
 * `load_skill` and are never exposed for writing.
 */

/**
 * The complete virtual filesystem layout for a task: the writable task mount,
 * the writable workspace skills mount, and any user-attached folders, each
 * read-only or writable according to the access the user granted it. This is
 * the single source of truth shared by the bash sandbox (just-bash filesystem),
 * the native-binary path bridge, and the dedicated file tools, so all three
 * agree on what the agent can see and where.
 */
export interface WorkspaceFsLayout {
  attached: WorkspaceFsMount[];
  /** Absent for a task that does not belong to a project. */
  project?: WorkspaceFsMount & { readOnly: false };
  skills: WorkspaceFsMount;
  task: WorkspaceFsMount & { hostRoot: TaskDir; readOnly: false };
}

/** A single virtual->real mount in the workspace filesystem. */
export interface WorkspaceFsMount {
  /** Real on-disk directory backing this mount. */
  hostRoot: AbsolutePath;
  /**
   * The `.instrument` dir at this mount's root is not the agent's to read or
   * write, and every consumer of the layout has to refuse it.
   *
   * A property of the mount rather than a case each consumer writes against the
   * task mount, because it is true of two mounts already and each of them holds
   * the settings that decide what the agent can reach: the task's attached
   * folders, the project's folder list and the access granted to each. A guard
   * spelled per consumer is one the next mount does not inherit, and the mount
   * whose settings widen access across every task in a project is the one that
   * arrived without it.
   */
  masksPrivateDir: boolean;
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
  { maxFileReadSize }: { maxFileReadSize: number },
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
    fs.mount(
      mount.mountPoint,
      masked(
        mount,
        mount.readOnly
          ? new OverlayFs({
              maxFileReadSize,
              mountPoint: "/",
              readOnly: true,
              root: mount.hostRoot,
            })
          : new ReadWriteFs({ maxFileReadSize, root: mount.hostRoot }),
      ),
    );
  }

  // The project folder, writable so the agent can edit the project's own
  // AGENTS.md when the user asks it to, with the private dir masked the way the
  // task mount's is: it holds the project's folder list and the access granted
  // to each, so a writable one would let the agent widen its own reach. Skipped
  // when the directory is gone (project deleted or renamed mid-turn), same as an
  // attached folder that no longer exists.
  if (layout.project && (await pathExists(layout.project.hostRoot))) {
    fs.mount(
      layout.project.mountPoint,
      masked(
        layout.project,
        new ReadWriteFs({ maxFileReadSize, root: layout.project.hostRoot }),
      ),
    );
  }

  // The workspace's own directory, always meant to be there, so create it if a
  // fresh workspace has not yet. Skipping the mount instead would leave the
  // agent writing to a `/skills` the prompt advertises but that does not exist.
  // Unlike an attached folder, it cannot be detached out from under us, so it
  // always mounts.
  await mkdir(layout.skills.hostRoot, { recursive: true });
  const skillsFs = new ReadWriteFs({
    maxFileReadSize,
    root: layout.skills.hostRoot,
  });
  fs.mount(layout.skills.mountPoint, skillWriteTrackingFs(skillsFs));

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
  attachedFolders,
  projectFolderName,
  taskHostRoot,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  /**
   * Folder under `projects/` holding the task's project, resolved to a host path
   * against this machine's workspace. A name rather than a path because the task
   * state it comes from travels between machines.
   */
  projectFolderName?: string;
  taskHostRoot: TaskDir;
}): WorkspaceFsLayout {
  const attached: WorkspaceFsMount[] = assignAttachedMounts(
    attachedFolders ?? {},
  ).map(({ folder, mountPoint }) => ({
    hostRoot: folder.path,
    // A folder the user attached is theirs, and an `.instrument` dir in it is
    // an ordinary directory of theirs rather than one of ours.
    masksPrivateDir: false,
    mountPoint,
    readOnly: effectiveFolderAccess(folder) !== "read-write",
  }));

  return {
    attached,
    // Writable, unlike an attached folder that overlaps the workspace (see
    // effectiveFolderAccess): this is the one directory inside the workspace the
    // user means the agent to edit, so it is granted deliberately and narrowly
    // rather than falling out of where the folder happens to sit. What that
    // guard is actually protecting -- the settings that name the project's
    // folders and the access granted to each -- is what `masksPrivateDir` keeps
    // out of reach.
    ...(projectFolderName
      ? {
          project: {
            hostRoot: absolutePathJoin(
              getWorkspaceConfig().projectsDir,
              projectFolderName,
            ),
            masksPrivateDir: true,
            mountPoint: MOUNT.project,
            readOnly: false as const,
          },
        }
      : {}),
    skills: {
      hostRoot: getWorkspaceSkillsDir(),
      masksPrivateDir: false,
      mountPoint: MOUNT.skills,
      readOnly: false,
    },
    task: {
      hostRoot: taskHostRoot,
      masksPrivateDir: true,
      mountPoint: MOUNT.task,
      readOnly: false,
    },
  };
}

/**
 * The access a folder actually gets: what the user granted, unless the folder
 * overlaps the workspace's own directory in either direction.
 *
 * Every task's database and state, every project's settings, and the skills
 * the agent loads as instructions live under the workspace root. A folder that
 * contains it, or sits inside it, would turn one task's write grant into write
 * access to every other task and a way to persist instructions across all of
 * them. Reading those files was already possible for anyone who attached such
 * a folder; writing them is refused.
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
export function effectiveFolderAccess(
  folder: FolderAttachment.Type,
): FolderAttachment.Access {
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
 * True when a host path escapes its owning mount through a symlink.
 *
 * The path need not exist: a write creates its target, and often the
 * directories above it, so a check that only contained existing paths would let
 * a new file under a symlinked directory land outside the mount. A missing
 * mount root is not an escape (nothing to reach; normal not-found handling
 * applies). Any other resolution failure (permission error, symlink loop, ...)
 * means containment cannot be verified, so it fails closed.
 */
export function hostPathEscapesMount(
  hostPath: string,
  hostRoot: string,
): boolean {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(hostRoot);
  } catch (error) {
    return !isEnoent(error);
  }

  const canonicalPath = canonicalizeThroughMissing(hostPath);
  if (canonicalPath === null) {
    return true;
  }

  return !pathIsWithin(canonicalPath, canonicalRoot);
}

/**
 * Whether a virtual path names the masked private dir of the mount that owns
 * it, or anything inside it.
 *
 * The one question every consumer of the layout asks in place of comparing a
 * mount against `layout.task`. Fails closed on a path the mount does not own,
 * which its caller has already ruled out by resolving it there.
 */
export function isMaskedPrivatePath(
  mount: WorkspaceFsMount,
  virtualAbsPath: string,
): boolean {
  if (!mount.masksPrivateDir) {
    return false;
  }
  const relative = relativeWithin(
    mount.mountPoint,
    normalizePath(virtualAbsPath),
  );
  return relative === null || isPrivateRelative(relative);
}

/** Every mount other than the task, in the order they are advertised. */
export function nonTaskMounts(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [
    ...layout.attached,
    ...(layout.project ? [layout.project] : []),
    layout.skills,
  ];
}

/** Virtual mount point of the masked-off private dir under the task mount. */
export function privateMountPoint(taskMountPoint: string): string {
  return `${taskMountPoint}/${TASK_FOLDER_NAMES.private}`;
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
 * so this is the sandbox's outer boundary and it deliberately bridges ONLY the
 * task mount. Every other virtual path quarantines to a path inside the task
 * dir that does not exist, so the binary fails with a not-found error instead
 * of touching the host. Do not "fix" this by resolving against the full layout.
 *
 * This holds for /mnt mounts the user granted write access to, not just the
 * read-only ones. A real host path is read AND write to the operating system,
 * so handing one to a subprocess would put the user's folder outside every
 * containment the sandbox has: no symlink check, no path masking, and no way
 * to tell what a build step touched. The agent copies a file into the task and
 * works on the copy instead. Writes back into the folder go through the virtual
 * filesystem, where the symlink check and the mount's access level still apply.
 */
export function resolveNativeHostPath(
  taskHostRoot: TaskDir,
  virtualAbsPath: string,
): AbsolutePath {
  const normalized = normalizePath(virtualAbsPath);
  const relative = relativeWithin(MOUNT.task, normalized);
  if (relative !== null && !isPrivateRelative(relative)) {
    return absolutePathJoin(
      taskHostRoot,
      relative === "/" ? "." : `.${relative}`,
    );
  }
  // Private-dir paths (and any non-/task virtual path) quarantine to a
  // non-existent path inside the task dir -- same defense as the read-only /mnt
  // mounts: a native binary must never receive a real path into task.db,
  // state.json, or settings, so it fails not-found instead of reading them.
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
 * Returns null for a path outside every mount, for the private dir, and for a
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
  const { hostPath, mount } = resolved;

  if (isMaskedPrivatePath(mount, virtualAbsPath)) {
    return null;
  }

  // The bash sandbox refuses to traverse a symlink out of a mount; a real
  // binary would happily follow it, so the containment has to be re-checked
  // here rather than inherited. Not asked of the task mount, whose own contents
  // the agent writes and reads by relative path in any case.
  if (mount !== layout.task && hostPathEscapesMount(hostPath, mount.hostRoot)) {
    return null;
  }
  return hostPath;
}

/** All mounts, task first. */
function allMounts(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [layout.task, ...nonTaskMounts(layout)];
}

/**
 * Canonical form of a path whose tail may not exist yet: resolve the deepest
 * ancestor that does, then re-attach the segments below it. Every symlink on
 * the existing part is followed, which is what makes the result safe to compare
 * against a mount root. Returns null when resolution fails for any reason other
 * than absence, so the caller can fail closed.
 */
function canonicalizeThroughMissing(hostPath: string): null | string {
  const missing: string[] = [];
  let current = hostPath;

  for (;;) {
    try {
      return nodePath.join(realpathSync(current), ...missing.toReversed());
    } catch (error) {
      if (!isEnoent(error)) {
        return null;
      }
    }

    const parent = nodePath.dirname(current);
    if (parent === current) {
      return null;
    }
    missing.push(nodePath.basename(current));
    current = parent;
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** A mount's filesystem with its private dir hidden, when it has one. */
function masked(mount: WorkspaceFsMount, fs: IFileSystem): IFileSystem {
  return mount.masksPrivateDir ? maskPrivateDirFs(fs) : fs;
}
