import { Button } from "@/client/components/ui/button";
import { ArrowSquareInIcon } from "@phosphor-icons/react/ArrowSquareIn";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";

import { WorkLine } from "./thread-work";
import { type Thread } from "./threads";

/**
 * What stands in the thread column while the thread floats in its small
 * view: the head stays over it with the thread's name and topics, and in
 * place of the transcript and the reply box a card says the conversation is
 * in the corner, carries the thread's work line, and offers the way to put
 * it back. The pane beside it keeps its tabs.
 */
export function PoppedOut({
  onBringBack,
  thread,
}: {
  onBringBack: () => void;
  thread: Thread | undefined;
}) {
  const lead =
    thread?.runningTasks.find((task) => task.waiting) ??
    thread?.runningTasks[0];
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center px-4"
      data-slot="popped-out"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-xl bg-card px-4 py-5 shadow-sm ring-1 ring-border">
        <span className="grid size-9 place-items-center rounded-lg bg-muted">
          <PictureInPictureIcon className="size-4.5 text-muted-foreground" />
        </span>
        <p className="text-[13px] font-medium">Popped out</p>
        {lead ? (
          <p className="flex max-w-full items-center gap-2 text-[12px] text-muted-foreground">
            <WorkLine task={lead} />
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            The conversation is in the corner.
          </p>
        )}
        <Button
          className="mt-1"
          onClick={onBringBack}
          size="sm"
          variant="outline"
        >
          <ArrowSquareInIcon className="size-3.5" />
          Bring back
        </Button>
      </div>
    </div>
  );
}
