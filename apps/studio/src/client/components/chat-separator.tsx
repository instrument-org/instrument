import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { type WrittenOn } from "@instrument-org/workspace/client";
import { format } from "date-fns/format";

import {
  type ChatSeparator,
  separatorDayLabel,
  separatorTimeLabel,
} from "../lib/chat-separators";
import { osConventions } from "../lib/utils";
import { ModelSwitch } from "./model-change-note";
import { ModelUsageChip, TooltipRow } from "./model-usage-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useNow } from "./window/use-now";

/**
 * A centered line above a message the person sent: the day, the time, the
 * model where the chat starts or switches, and the computer where the chat
 * moved to another. What the model actually did, and where the chat was
 * before, are in their cards, never on the line.
 */
export function ChatSeparatorRow({ separator }: { separator: ChatSeparator }) {
  const now = useNow();
  const { at, change, computer, timed, usage } = separator;

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 pt-1.5 pb-3 text-xs text-muted-foreground opacity-50">
      {timed && (
        <span className="shrink-0">
          <span className="font-medium">{separatorDayLabel(at, now)}</span>{" "}
          {separatorTimeLabel(at)}
        </span>
      )}
      {computer && (
        <>
          {timed && <span aria-hidden="true">·</span>}
          <ComputerMove at={at} {...computer} />
        </>
      )}
      {(change ?? usage) && (timed || computer) && (
        <span aria-hidden="true">·</span>
      )}
      {change ? (
        <ModelSwitch from={change.from} to={change.to} />
      ) : (
        usage && <ModelUsageChip usage={usage} />
      )}
    </div>
  );
}

/**
 * Where the chat moved, as a line the card behind it says more of: which
 * computer ran it before, which runs it now, and from when.
 */
function ComputerMove({
  at,
  back,
  from,
  to,
}: {
  at: Date;
  back: boolean;
  from: WrittenOn;
  to: WrittenOn;
}) {
  const { thisComputer: thisOne } = osConventions();
  const named = (on: WrittenOn) =>
    on.here ? `${on.name} (${thisOne})` : on.name;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 items-center gap-1">
          <DesktopIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {to.here
              ? back
                ? `Back on ${thisOne}`
                : `Continued on ${thisOne}`
              : `Continued on ${to.name}`}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent align="center" className="p-3 text-xs" side="top">
        <div className="space-y-2">
          <TooltipRow label="Before:" value={named(from)} />
          <TooltipRow label="From here on:" value={named(to)} />
          <TooltipRow label="Moved:" value={format(at, "MMM d, p")} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
