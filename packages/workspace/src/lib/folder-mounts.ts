import { MOUNT } from "../mount-points";
import { type MountedFolder } from "../schemas/mounted-folder";

/**
 * Mount points for every folder the chat reaches, in iteration order.
 *
 * Mount names are unique per chat -- `folderReach` assigns them with
 * `assignMountNames` and keys its answer by name -- so mount points normally
 * never collide and {@link folderMountPoint} is safe to derive from a name
 * anywhere. The "(n)" suffix here is a backstop for a set that broke the
 * invariant: the bash sandbox (last mount wins) and the file tools (longest
 * match wins) would otherwise disagree about a duplicated mount point,
 * leaving one folder unreachable.
 */
export function assignMountPoints(
  folders: Record<string, MountedFolder.Type>,
): { folder: MountedFolder.Type; mountPoint: string }[] {
  const used = new Set<string>();
  const assigned: { folder: MountedFolder.Type; mountPoint: string }[] = [];

  for (const folder of Object.values(folders)) {
    const base = folderMountPoint(folder.mountName);
    let mountPoint = base;
    for (let n = 2; used.has(mountPoint); n++) {
      mountPoint = `${base} (${n})`;
    }
    used.add(mountPoint);
    assigned.push({ folder, mountPoint });
  }

  return assigned;
}

/**
 * Virtual mount path for a folder, e.g. "Family Photos" ->
 * "/mnt/Family Photos", or "Home/Downloads" -> "/mnt/Home/Downloads" for a
 * folder inside one of the chat's own mounts.
 *
 * Names are unique per chat (see assignMountNames, assignMountPoints), so
 * this is a stable one-to-one mapping. Each segment is kept as written; an empty,
 * `.` or `..` one falls back to a placeholder purely defensively, so no name
 * reaches outside `/mnt`.
 */
export function folderMountPoint(name: string) {
  const segments = name.split("/").map((segment) => {
    const trimmed = segment.trim();
    return trimmed === "" || trimmed === "." || trimmed === ".."
      ? "folder"
      : trimmed;
  });
  return `${MOUNT.folders}/${segments.join("/")}`;
}
