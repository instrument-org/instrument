import { type FolderAttachment } from "../schemas/folder-attachment";

interface ProjectFolder {
  access: FolderAttachment.Access;
  path: string;
}

/**
 * Settles a task's folders against its project's, when the two disagree.
 *
 * Both sides may edit an inherited folder: the project, which reaches every one
 * of its tasks, and the task, for the work in front of it. The later edit is the
 * one that holds, and `baseline` is what makes "later" answerable without
 * timestamps. It records what the project said when this task last looked, so a
 * live value that still matches it means the project has not moved since, which
 * leaves the task's version as the newer of the two.
 *
 * Read the other way round, the same comparison covers a folder the task
 * detached: a project path with no attachment and an unchanged baseline is one
 * the task said no to. Change it in the project and it comes back, because that
 * edit is now the later one.
 *
 * A path with no baseline entry has never been offered to this task, so there is
 * nothing for the task to have decided and the project's version is taken.
 *
 * Pure: minting an attachment needs an id and a clock, so the folders to attach
 * come back as the project stated them and the caller makes the records.
 */
export function reconcileProjectFolders({
  attached,
  baseline,
  projectFolders,
}: {
  attached: FolderAttachment.Type[];
  baseline: Record<string, FolderAttachment.Access>;
  projectFolders: ProjectFolder[];
}): {
  /** What the project says now, to compare against next time. */
  nextBaseline: Record<string, FolderAttachment.Access>;
  /** Attached folders the project no longer offers, dropped from the task. */
  removed: FolderAttachment.Type[];
  /** Every folder the task keeps, with each inherited access settled. */
  surviving: FolderAttachment.Type[];
  /** Project folders the task should take on. */
  toAttach: ProjectFolder[];
} {
  const liveAccessByPath = new Map(
    projectFolders.map((folder) => [folder.path, folder.access]),
  );
  const attachedPaths = new Set<string>(attached.map((folder) => folder.path));

  const removed: FolderAttachment.Type[] = [];
  const surviving: FolderAttachment.Type[] = [];

  for (const folder of attached) {
    if (folder.source !== "project") {
      surviving.push(folder);
      continue;
    }
    const liveAccess = liveAccessByPath.get(folder.path);
    if (liveAccess === undefined) {
      removed.push(folder);
      continue;
    }
    surviving.push({
      ...folder,
      access: liveAccess === baseline[folder.path] ? folder.access : liveAccess,
    });
  }

  const toAttach = projectFolders.filter(
    (folder) =>
      !attachedPaths.has(folder.path) &&
      baseline[folder.path] !== folder.access,
  );

  return {
    nextBaseline: Object.fromEntries(liveAccessByPath),
    removed,
    surviving,
    toAttach,
  };
}
