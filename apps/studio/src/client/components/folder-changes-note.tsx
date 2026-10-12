import { folderLabel } from "@/client/lib/path-utils";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { FolderIcon } from "@phosphor-icons/react/Folder";

/**
 * What changed about the folders granted in this chat, above the message it
 * took effect on.
 *
 * A folder taken back is shown, since it is gone for the agent from this
 * message on. The other two changes are not, outside developer mode. A
 * folder granted already shows where it was granted: on the message that
 * sent it, or on the card that asked for it. A rename here is of the mount
 * we assign, not of the user's folder, so reporting one describes something
 * they never did. In developer mode the grants are listed too, since there
 * the note is read to find out what the agent was told.
 */
export function FolderChangesNote({
  data,
  isDeveloperMode = false,
}: {
  data: SessionMessageDataPart.FolderChangesDataPart;
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
