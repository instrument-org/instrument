import {
  type ChatSeparator,
  separatorDayLabel,
  separatorTimeLabel,
} from "../lib/chat-separators";
import { ModelSwitch } from "./model-change-note";
import { ModelUsageChip } from "./model-usage-chip";
import { useNow } from "./window/use-now";

/**
 * A centered line above a message the person sent: the day, the time, and the
 * model where the chat starts or switches. What the model actually did is in
 * the chip's card, never on the line.
 */
export function ChatSeparatorRow({ separator }: { separator: ChatSeparator }) {
  const now = useNow();
  const { at, change, timed, usage } = separator;

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 pt-1.5 pb-3 text-xs text-muted-foreground">
      {timed && (
        <span className="shrink-0">
          <span className="font-medium">{separatorDayLabel(at, now)}</span>{" "}
          {separatorTimeLabel(at)}
        </span>
      )}
      {(change ?? usage) && timed && <span aria-hidden="true">·</span>}
      {change ? (
        <ModelSwitch from={change.from} to={change.to} />
      ) : (
        usage && <ModelUsageChip usage={usage} />
      )}
    </div>
  );
}
