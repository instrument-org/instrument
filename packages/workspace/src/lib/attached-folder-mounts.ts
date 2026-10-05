import { MOUNT } from "../mount-points";
import { type FolderAttachment } from "../schemas/folder-attachment";

/**
 * Mount points for every attached folder, in iteration order.
 *
 * Folder names are unique per task -- every attachedFolders writer goes
 * through grantFolders (see grant-folders.ts), and the record is keyed by
 * name -- so mount points normally never collide and
 * {@link attachedFolderMountPoint} is safe to derive from a name anywhere. The
 * "(n)" suffix here is a backstop for state that violated the invariant (e.g. a
 * hand-edited state.json): the bash sandbox (last mount wins) and the file
 * tools (longest match wins) would otherwise disagree about a duplicated mount
 * point, leaving one folder unreachable.
 */
export function assignAttachedMounts(
  attachedFolders: Record<string, FolderAttachment.Type>,
): { folder: FolderAttachment.Type; mountPoint: string }[] {
  const used = new Set<string>();
  const assigned: { folder: FolderAttachment.Type; mountPoint: string }[] = [];

  for (const folder of Object.values(attachedFolders)) {
    const base = attachedFolderMountPoint(folder.mountName);
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
 * Virtual mount path for an attached folder, e.g. "Family Photos" ->
 * "/mnt/Family Photos", or "Home/Downloads" -> "/mnt/Home/Downloads" for a
 * task its chat handed a folder inside one of the chat's own mounts.
 *
 * Names are unique per task (see grantFolders, assignAttachedMounts), so this
 * is a stable one-to-one mapping. Each segment is kept as written; an empty,
 * `.` or `..` one falls back to a placeholder purely defensively, so no name
 * reaches outside `/mnt`.
 */
export function attachedFolderMountPoint(name: string) {
  const segments = name.split("/").map((segment) => {
    const trimmed = segment.trim();
    return trimmed === "" || trimmed === "." || trimmed === ".."
      ? "folder"
      : trimmed;
  });
  return `${MOUNT.attachedFolders}/${segments.join("/")}`;
}
