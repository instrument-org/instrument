import { useRelativeTime } from "@/client/hooks/use-relative-time";
import { formatAbsoluteTime } from "@/client/lib/relative-time";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function RelativeTime({
  className,
  compact = false,
  date,
  tooltip = true,
}: {
  className?: string;
  /**
   * The narrowest rendering ("12m ago", "5h ago", "3d ago"), for a row whose
   * title wants the width more than the timestamp does.
   */
  compact?: boolean;
  date: Date;
  /**
   * Off where the row already owns hover (a command palette item, a dense list
   * row with its own menu), since a second hover surface there competes with
   * the one the user is aiming for.
   */
  tooltip?: boolean;
}) {
  const text = useRelativeTime(date, { compact });

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
