import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { PlugsIcon } from "@phosphor-icons/react/Plugs";

/**
 * What changed about the apps this task can reach, above the message it took
 * effect on.
 *
 * The same shape as the folder note beside it, for the same reason: the change
 * was made in the conversation the user is not looking at, and this is where
 * they find out the task has what it was waiting for.
 */
export function TaskAppChangesNote({
  data,
}: {
  data: SessionMessageDataPart.TaskAppChangesDataPart;
}) {
  const changes: string[] = [];
  const [gained] = data.added;
  const [lost] = data.removed;

  if (gained && data.added.length === 1) {
    changes.push(`can now reach ${gained.name}`);
  } else if (data.added.length > 1) {
    changes.push(`can now reach ${data.added.length} apps`);
  }

  if (lost && data.removed.length === 1) {
    changes.push(`lost access to ${lost.name}`);
  } else if (data.removed.length > 1) {
    changes.push(`lost access to ${data.removed.length} apps`);
  }

  if (changes.length === 0) {
    return null;
  }

  const summary = changes.join(", ");

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70">
        <PlugsIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          {summary.charAt(0).toUpperCase() + summary.slice(1)}
        </span>
      </div>
    </div>
  );
}
