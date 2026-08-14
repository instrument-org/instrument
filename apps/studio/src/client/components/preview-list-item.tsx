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
    // Its own surface rather than a button variant's. This is the compact form
    // of a `FilePreviewCard` row and wants that card's language -- card fill,
    // brand tint once the pane is showing the file -- which no variant carries;
    // borrowing one meant its next round of tuning arrived here as a filename
    // nobody could read.
    <button
      className={cn(
        "flex h-12 w-full items-center gap-x-2 overflow-hidden rounded-lg px-3 text-left text-foreground",
        "transition-[outline] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
        isSelected
          ? "border border-black/5 bg-brand-600/8 dark:bg-brand-300/8"
          : "bg-card shadow-xs hover:bg-muted/40 dark:border dark:border-black/5 dark:hover:bg-muted/40",
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
