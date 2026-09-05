import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";

/**
 * The line that marks why the orchestrator woke: a task it created finished a
 * turn. One line per task, in the muted voice of a note rather than a
 * message, since the orchestrator's own reply is what the reader is waiting
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
          key={event.taskId}
        >
          <CheckCircleIcon className="size-3.5 shrink-0" />
          <span>
            {event.status === "error"
              ? "Stopped: "
              : event.status === "overdue"
                ? "Still working: "
                : "Finished: "}
            {event.title}
          </span>
        </p>
      ))}
    </div>
  );
}
