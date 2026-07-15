import { type FolderAttachment } from "../schemas/folder-attachment";
import { ATTACHED_FOLDERS_MOUNT_ROOT } from "../schemas/paths";

/**
 * Mount points for every attached folder, in iteration order.
 *
 * Folder names are unique per task -- every attachedFolders writer routes the
 * whole set through assignFolderNames (see assign-folder-names.ts) on each
 * attach, and the record is keyed by name -- so mount points normally never
 * collide and {@link attachedFolderMountPoint} is safe to derive from a name
 * anywhere. The "(n)" suffix here is a backstop for state that violated the
 * invariant (e.g. a hand-edited state.json): the bash sandbox (last mount
 * wins) and the file tools (longest match wins) would otherwise disagree
 * about a duplicated mount point, leaving one folder unreachable.
 */
export function assignAttachedMounts(
  attachedFolders: Record<string, FolderAttachment.Type>,
): { folder: FolderAttachment.Type; mountPoint: string }[] {
  const used = new Set<string>();
  const assigned: { folder: FolderAttachment.Type; mountPoint: string }[] = [];

  for (const folder of Object.values(attachedFolders)) {
    const base = attachedFolderMountPoint(folder.name);
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
 * "/mnt/Family Photos".
 *
 * Names are derived from the folder's path and unique per task (see
 * assignFolderNames, assignAttachedMounts), so this is a stable one-to-one
 * mapping; path separators are flattened and degenerate names fall back to a
 * placeholder purely defensively.
 */
export function attachedFolderMountPoint(name: string) {
  const segment = name.replaceAll("/", "-").trim();
  const safe =
    segment === "" || segment === "." || segment === ".." ? "folder" : segment;
  return `${ATTACHED_FOLDERS_MOUNT_ROOT}/${safe}`;
}
