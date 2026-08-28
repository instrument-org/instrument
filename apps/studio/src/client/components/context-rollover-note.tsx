import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";

/**
 * Where the conversation ran out of context window and continued in a fresh one.
 *
 * A rule across the transcript rather than a note aligned to one side: the
 * other notes report a change the user made to one turn, and this reports the
 * conversation itself starting over, which belongs between the turns it
 * separates.
 *
 * The messages above stay on screen, so the wording says what the agent
 * carried rather than what was removed. Nothing here is deleted, and saying
 * "dropped" over a transcript the reader can still scroll would describe a
 * different thing than what happened.
 */
export function ContextRolloverNote({
  data,
}: {
  data: SessionMessageDataPart.ContextRolloverDataPart;
}) {
  const carried =
    data.retainedUserMessages === 1
      ? "1 of your messages carried forward"
      : `${data.retainedUserMessages} of your messages carried forward`;

  return (
    <div
      className="my-3 flex w-full items-center gap-x-2 text-xs text-muted-foreground/70"
      title="The context window filled up, so the agent continued from your own messages. Everything above is still here to read, but the agent is no longer working from it."
    >
      <span className="h-px flex-1 bg-border" />
      <ArrowClockwiseIcon className="size-3.5 shrink-0" />
      <span className="shrink-0">
        Continued in a new context window
        {data.retainedUserMessages > 0 ? `, ${carried}` : ""}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
