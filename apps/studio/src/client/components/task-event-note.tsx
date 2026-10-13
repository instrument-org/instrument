import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";

/**
 * The line that marks why the chat woke, a task it created finishing a
 * turn, or that one ended without waking it, stopped by the user or cut off
 * by the app's quit. One line per task, in the muted voice of a note rather
 * than a message, since the chat's own reply is what the reader is waiting
 * for.
 */
export function TaskEventNote({
  data,
}: {
  data: SessionMessageDataPart.TaskEventDataPart;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {data.events.map((event) => (
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          key={event.sessionId}
        >
          {event.stoppedBy ? (
            <StopCircleIcon className="size-3.5 shrink-0" />
          ) : (
            <CheckCircleIcon className="size-3.5 shrink-0" />
          )}
          <span>
            {event.stoppedBy === "app"
              ? "Interrupted when the app closed: "
              : event.stoppedBy === "user"
                ? "You stopped: "
                : event.status === "error"
                  ? "Stopped: "
                  : event.status === "overdue"
                    ? "Still working: "
                    : "Finished: "}
            {event.title}
            {/* Past tense on purpose: the note is written once, and what was
                left running then may have been stopped since. */}
            {event.running && event.running.length > 0
              ? event.stoppedBy === "app"
                ? ` · ended ${event.running.length} running`
                : ` · left ${event.running.length} running`
              : null}
          </span>
        </p>
      ))}
    </div>
  );
}
