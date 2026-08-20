import { folderNameFromPath } from "@/client/lib/path-utils";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { FolderIcon } from "@phosphor-icons/react/Folder";

/**
 * What changed about this task's folders, above the message it took effect on.
 *
 * The same shape as the project's note beside it, for the same reason: a change
 * made in the panel is silent until a turn carries it, and this is where the
 * user finds out that the one they made is the one the agent has.
 *
 * Renames are deliberately absent. A rename here is of the mount we assign, not
 * of the user's folder, so reporting one describes something they never did.
 */
export function AttachedFolderChangesNote({
  data,
}: {
  data: SessionMessageDataPart.AttachedFolderChangesDataPart;
}) {
  const changes: string[] = [];
  const [regranted] = data.accessChanged;
  const [detached] = data.removed;

  if (regranted && data.accessChanged.length === 1) {
    changes.push(
      `${folderNameFromPath(regranted.path)} ${
        regranted.access === "read-write"
          ? "now has full access"
          : "is now read-only"
      }`,
    );
  } else if (data.accessChanged.length > 1) {
    changes.push(`${data.accessChanged.length} folders changed access`);
  }

  if (detached && data.removed.length === 1) {
    changes.push(`removed ${folderNameFromPath(detached.path)}`);
  } else if (data.removed.length > 1) {
    changes.push(`removed ${data.removed.length} folders`);
  }

  if (changes.length === 0) {
    return null;
  }

  const summary = changes.join(", ");

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          {summary.charAt(0).toUpperCase() + summary.slice(1)}
        </span>
      </div>
    </div>
  );
}
