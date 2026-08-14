import type { ReactNode } from "react";

import { cn } from "@/client/lib/utils";

import { Button } from "./ui/button";
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
    <Button
      className={cn(
        "h-12 w-full justify-start gap-x-2 overflow-hidden",
        // The brand tint a full-width `FilePreviewCard` row takes when the pane
        // is showing its file, so a chip and a row read as the same state. Hover
        // holds the tint rather than falling back to the variant's, which would
        // otherwise paint the selected chip as an unselected one under the
        // pointer.
        isSelected &&
          "bg-brand-600/8 not-disabled:hover:bg-brand-600/8 dark:bg-brand-300/8 dark:not-disabled:hover:bg-brand-300/8",
      )}
      onClick={onClick}
      type="button"
      variant="outline-muted"
    >
      {icon}
      <span className="min-w-0 truncate text-left text-xs/tight">{label}</span>
      {rightElement && <div className="ml-auto shrink-0">{rightElement}</div>}
    </Button>
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
