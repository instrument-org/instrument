import type { ReactNode } from "react";

import { cn } from "@/client/lib/utils";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function PreviewListItem({
  icon,
  isSelected = false,
  label,
  onClick,
  rightElement,
  tooltipContent,
}: {
  icon: ReactNode;
  isSelected?: boolean;
  label: string;
  onClick: () => void;
  rightElement?: ReactNode;
  tooltipContent?: string;
}) {
  const button = (
    // Its own surface rather than a button variant's, taken from the folder
    // block a message carries beside these (`FolderAttachmentsCard`): the same
    // fill and elevation, one chip at a time instead of one divided block. The
    // hairline comes with `shadow-xs`, which is the soft ramp over a 1px ring --
    // a `border` on top of it is that edge drawn twice. Borrowing a variant
    // instead meant its next round of tuning arrived here as a filename nobody
    // could read.
    <button
      className={cn(
        "flex h-12 w-full items-center gap-x-2 overflow-hidden rounded-lg bg-background px-3 text-left text-foreground shadow-xs",
        "transition-[outline] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
        // The brand tint a `FilePreviewCard` takes when the pane is showing its
        // file, so a chip and a full-width card read as the same state.
        isSelected ? "bg-brand-600/8 dark:bg-brand-300/8" : "hover:bg-muted",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="min-w-0 truncate text-xs/tight">{label}</span>
      {rightElement && <div className="ml-auto shrink-0">{rightElement}</div>}
    </button>
  );

  if (!tooltipContent) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        className="wrap-break-word"
        collisionPadding={10}
        maxWidth="500px"
      >
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
