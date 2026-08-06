import {
  clockSubscriber,
  formatAbsoluteTime,
  formatRelativeTime,
  getSharedNow,
  relativeTickMs,
} from "@/client/lib/relative-time";
import { useSyncExternalStore } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function RelativeTime({
  className,
  date,
  tooltip = true,
}: {
  className?: string;
  date: Date;
  /**
   * Off where the row already owns hover (a command palette item, a dense list
   * row with its own menu), since a second hover surface there competes with
   * the one the user is aiming for.
   */
  tooltip?: boolean;
}) {
  const now = useRelativeNow(date);
  const text = formatRelativeTime(date, now);

  if (!tooltip) {
    return <span className={className}>{text}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{text}</span>
      </TooltipTrigger>
      <TooltipContent>{formatAbsoluteTime(date)}</TooltipContent>
    </Tooltip>
  );
}

function noopSubscribe() {
  return unsubscribeNothing;
}

function unsubscribeNothing() {
  // A snapshot that can never change has no timer behind it to tear down.
}

/**
 * Re-renders only when this instant's own rendering can have changed. An
 * instance old enough to render as a date subscribes to nothing.
 */
function useRelativeNow(date: Date) {
  const intervalMs = relativeTickMs(getSharedNow() - date.getTime());

  return useSyncExternalStore(
    intervalMs === null ? noopSubscribe : clockSubscriber(intervalMs),
    getSharedNow,
  );
}
