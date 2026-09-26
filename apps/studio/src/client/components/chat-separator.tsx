import {
  type ChatSeparator,
  separatorDayLabel,
  separatorTimeLabel,
} from "../lib/chat-separators";
import { ModelUsageChip } from "./model-usage-chip";
import { useNow } from "./orchestrator/use-now";

/**
 * A centered line above a message the person sent: the day, the time, and the
 * model where the chat starts or switches. What the model actually did is in
 * the chip's card, never on the line.
 */
export function ChatSeparatorRow({ separator }: { separator: ChatSeparator }) {
  const now = useNow();
  const { at, usage } = separator;

  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">
        <span className="font-semibold">{separatorDayLabel(at, now)}</span>{" "}
        {separatorTimeLabel(at)}
      </span>
      {usage && (
        <>
          <span aria-hidden="true">·</span>
          <ModelUsageChip usage={usage} />
        </>
      )}
    </div>
  );
}
