import { Button } from "@/client/components/ui/button";
import { StopIcon } from "@phosphor-icons/react/Stop";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Ends a process the agent left running.
 *
 * An icon rather than the word: these sit at the end of a row that already
 * carries a name and a duration, and a third run of text there reads as more to
 * consider rather than as something to press. The tooltip carries what the icon
 * cannot -- whether this ends one process or every one -- and doubles as the
 * accessible name.
 */
export function StopProcessButton({
  className,
  disabled,
  label,
  onClick,
}: {
  className?: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn("shrink-0", className)}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          variant="ghost"
        >
          <StopIcon weight="fill" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
