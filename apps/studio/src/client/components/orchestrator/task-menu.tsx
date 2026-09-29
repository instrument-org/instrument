import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { useTranscriptActions } from "@/client/components/task/transcript-actions";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { showInFolderLabel, showTaskFolder } from "@/client/lib/show-in-files";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";

/**
 * The menu beside a task's name, for what someone looking over its shoulder can
 * do with the run itself rather than with anything in it: save its transcript,
 * or open the folder it worked in.
 */
export function TaskMenu({
  sessionId,
  taskId,
}: {
  /** The session the transcript on screen is showing. */
  sessionId: StoreId.Session | undefined;
  taskId: TaskId;
}) {
  const transcript = useTranscriptActions({ id: taskId, sessionId });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Task actions"
          className={toolbarClassName({
            className:
              "size-6 shrink-0 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            pressed: false,
          })}
          size="icon-sm"
          variant="ghost"
        >
          <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        {/* Saves without opening anything: the transcript is on its way
          somewhere else, and the path lands on the clipboard for it. */}
        <DropdownMenuItem
          disabled={!sessionId}
          onSelect={() => {
            transcript.save("markdown");
          }}
        >
          <ArrowLineDownIcon className="size-4" />
          Save transcript
        </DropdownMenuItem>
        {/* The task's own folder, which is where its deliverables land and the
          only way to see what it wrote that it never mentioned. */}
        <DropdownMenuItem
          onSelect={() => {
            void showTaskFolder(taskId);
          }}
        >
          <ShowInFolderIcon className="size-4" kind="folder" />
          {showInFolderLabel("folder")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
