import {
  type IFileSystem,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";
import { realpathSync } from "node:fs";

import { type FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { assignAttachedMounts } from "./attached-folder-mounts";
import { normalizePath } from "./normalize-path";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { ReadOnlyBaseFs } from "./read-only-base-fs";

/**
 * Virtual mount point of the writable task directory.
 *
 * The task is mounted under a named home (`/task`) rather than the filesystem
 * root so the agent has a clear, stable place to work and is less prone to
 * hallucinating host paths. Relative paths (work/, output/, attachments/, ...)
 * are unaffected since the working directory is this mount. Every virtual<->real
 * translator routes through the layout, so this is the single value to change.
 */
export const TASK_MOUNT_POINT = "/task";

/**
 * The complete virtual filesystem layout for a task: the writable task mount
 * plus any read-only user-attached folders. This is the single source of truth
 * shared by the bash sandbox (just-bash filesystem), the native-binary path
 * bridge, and the dedicated file tools, so all three agree on what the agent
 * can see and where.
 */
export interface WorkspaceFsLayout {
  attached: WorkspaceFsMount[];
  task: WorkspaceFsMount & { hostRoot: TaskDir; readOnly: false };
}

/** A single virtual->real mount in the workspace filesystem. */
interface WorkspaceFsMount {
  /** Real on-disk directory backing this mount. */
  hostRoot: AbsolutePath;
  /** Absolute, normalized virtual path where the directory appears. */
  mountPoint: string;
  /**
   * When true the mount is read-only: writes throw EROFS in the virtual FS, and
   * the host path is never handed to a real native binary (which could write to
   * the user's real files). Read-only mounts must be copied into the task before
   * native tools can process them.
   */
  readOnly: boolean;
}

/**
 * Build the just-bash filesystem the bash interpreter runs against, from the
 * layout: an empty read-only base holds the virtual root (so stray writes like
 * /tmp/x fail loudly instead of evaporating with the per-call filesystem), the
 * task mounts writable at its mount point, and attached folders mount
 * read-only.
 */
export async function buildBashFs(
  layout: WorkspaceFsLayout,
  { maxFileReadSize }: { maxFileReadSize: number },
): Promise<IFileSystem> {
  const fs = new MountableFs({ base: new ReadOnlyBaseFs() });

  fs.mount(
    layout.task.mountPoint,
    new ReadWriteFs({ maxFileReadSize, root: layout.task.hostRoot }),
  );

  for (const mount of layout.attached) {
    // Folders can be detached or deleted on disk between turns; OverlayFs throws
    // if its root is missing, so skip any that no longer exist.
    if (!(await pathExists(mount.hostRoot))) {
      continue;
    }
    fs.mount(
      mount.mountPoint,
      new OverlayFs({
        maxFileReadSize,
        mountPoint: "/",
        readOnly: mount.readOnly,
        root: mount.hostRoot,
      }),
    );
  }

  return fs;
}

/**
 * Build the layout for a task. Pure and synchronous so the dedicated file tools
 * can resolve paths without disk I/O; bash's buildBashFs skips any attached
 * folder that is missing on disk at mount time.
 */
export function buildWorkspaceFsLayout({
  attachedFolders,
  taskHostRoot,
}: {
  attachedFolders?: Record<string, FolderAttachment.Type>;
  taskHostRoot: TaskDir;
}): WorkspaceFsLayout {
  const attached: WorkspaceFsMount[] = assignAttachedMounts(
    attachedFolders ?? {},
  ).map(({ folder, mountPoint }) => ({
    hostRoot: folder.path,
    mountPoint,
    readOnly: true,
  }));

  return {
    attached,
    task: {
      hostRoot: taskHostRoot,
      mountPoint: TASK_MOUNT_POINT,
      readOnly: false,
    },
  };
}

/**
 * True when an existing host path escapes its owning mount through a symlink.
 * Missing paths or roots are left to normal not-found handling.
 */
export function hostPathEscapesMount(
  hostPath: string,
  hostRoot: string,
): boolean {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(hostRoot);
  } catch {
    return false;
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(hostPath);
  } catch {
    return false;
  }

  return !pathIsWithin(canonicalPath, canonicalRoot);
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
 * task mount. Every other virtual path -- read-only /mnt mounts especially,
 * whose host paths must never reach a subprocess that could write to the
 * user's real files -- quarantines to a path inside the task dir that does not
 * exist, so the binary fails with a not-found error instead of touching the
 * host. Do not "fix" this by resolving against the full layout.
 */
export function resolveNativeHostPath(
  taskHostRoot: TaskDir,
  virtualAbsPath: string,
): AbsolutePath {
  const normalized = normalizePath(virtualAbsPath);
  const relative = relativeWithin(TASK_MOUNT_POINT, normalized);
  if (relative !== null) {
    return absolutePathJoin(taskHostRoot, relative === "/" ? "." : `.${relative}`);
  }
  return absolutePathJoin(taskHostRoot, normalized);
}

/**
 * Reverse of resolveHostPath: map a real on-disk path back to its virtual path,
 * or null if it falls outside every mount. Used to keep native-binary output
 * sandbox-shaped. The longest matching host root wins.
 */
export function resolveVirtualPath(
  layout: WorkspaceFsLayout,
  hostPath: string,
): null | string {
  const normalizedHost = normalizePath(hostPath);

  let best: null | {
    mount: WorkspaceFsMount;
    relative: string;
    rootLen: number;
  } = null;
  for (const mount of allMounts(layout)) {
    const root = normalizePath(mount.hostRoot);
    const relative =
      normalizedHost === root
        ? "/"
        : normalizedHost.startsWith(`${root}/`)
          ? normalizedHost.slice(root.length)
          : null;
    if (relative === null) {
      continue;
    }
    if (best === null || root.length > best.rootLen) {
      best = { mount, relative, rootLen: root.length };
    }
  }

  if (best === null) {
    return null;
  }

  if (best.relative === "/") {
    return best.mount.mountPoint;
  }
  return `${best.mount.mountPoint}${best.relative}`;
}

/** All mounts, task first. */
function allMounts(layout: WorkspaceFsLayout): WorkspaceFsMount[] {
  return [layout.task, ...layout.attached];
}

/**
 * Relative path of `virtualAbs` within `mountPoint`, or null if not contained.
 * Mirrors just-bash MountableFs routing: an exact match yields "/" and a child
 * yields the remainder including its leading slash.
 */
function relativeWithin(mountPoint: string, virtualAbs: string): null | string {
  if (virtualAbs === mountPoint) {
    return "/";
  }
  if (virtualAbs.startsWith(`${mountPoint}/`)) {
    return virtualAbs.slice(mountPoint.length);
  }
  return null;
}
