import { folderLabel } from "@/client/lib/path-utils";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { FolderIcon } from "@phosphor-icons/react/Folder";

/**
 * What changed about this task's folders, above the message it took effect on.
 *
 * The same shape as the project's note beside it, for the same reason: a change
 * made in the panel is silent until a turn carries it, and this is where the
 * user finds out that the one they made is the one the agent has.
 *
 * Two of the four changes are ours rather than theirs, and neither is shown
 * outside developer mode. A rename here is of the mount we assign, not of the
 * user's folder, so reporting one describes something they never did. And a
 * folder arriving is most often the conversation handing one to a task it is
 * running: real, but nothing the person reading this chat did or has to act
 * on. In developer mode it says which, since there it is being
 * read to find out what the agent was told. A change of access is never
 * shown: what a task may do in a folder is the conversation's to decide.
 */
export function AttachedFolderChangesNote({
  data,
  isDeveloperMode = false,
}: {
  data: SessionMessageDataPart.AttachedFolderChangesDataPart;
  isDeveloperMode?: boolean;
}) {
  const changes: string[] = [];
  const [detached] = data.removed;

  if (isDeveloperMode && data.added.length > 0) {
    changes.push(
      `added ${data.added
        .map((folder) => folderLabel(folder.path))
        .join(", ")}`,
    );
  }

  if (detached && data.removed.length === 1) {
    changes.push(`removed ${folderLabel(detached.path)}`);
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
