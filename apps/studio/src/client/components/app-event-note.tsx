import { InstrumentGlyph } from "@/client/components/wordmark";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";

/**
 * The line that marks why the orchestrator woke about an app: the user signed
 * in, saved a key, declined, or took it away. A product event in the muted
 * voice of a note, with the mark rather than an icon of its own, since the
 * product did this and the reply that follows is what the reader waits for.
 */
export function AppEventNote({
  data,
}: {
  data: SessionMessageDataPart.AppEventDataPart;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {data.events.map((event) => (
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          key={`${event.slug}:${event.event}`}
        >
          <InstrumentGlyph className="size-3.5 shrink-0" />
          <span>
            {event.event === "connected"
              ? `${event.name} connected`
              : event.event === "declined"
                ? `${event.name} not connected`
                : event.event === "disconnected"
                  ? `${event.name} disconnected`
                  : event.event === "removed"
                    ? `${event.name} removed`
                    : `${event.name} could not connect`}
          </span>
        </p>
      ))}
    </div>
  );
}
