import { cn } from "@/client/lib/utils";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { type ReactNode } from "react";

import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// Shared shell for developer-mode-only regions: a dashed, muted card. Pairs with
// DevModeCardHeader for the badge-led header used across debug peeks (injected
// model context).
export function DevModeCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/30 p-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DevModeCardHeader({
  action,
  caption,
}: {
  action?: ReactNode;
  caption: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <DeveloperModeBadge />
      <span className="text-[10px] leading-tight text-muted-foreground">
        {caption}
      </span>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/**
 * A row of the chat that is there only because developer mode is on: the
 * agent's commands, its reasoning, the notes that woke it. Developer mode's
 * color on a dashed edge, the way the chat's developer notes are drawn, so
 * none of it reads as something a person using the app would see.
 */
export function ChatDevOnly({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-r-lg border-l-2 border-dashed border-dev-700/50 bg-dev-500/5 pr-2 pl-2 dark:border-dev-300/40">
      <div className="min-w-0 flex-1">{children}</div>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <EyeIcon
            aria-label="Only visible in developer mode"
            className="size-3 shrink-0 text-dev-700/60 dark:text-dev-300/50"
          />
        </TooltipTrigger>
        <TooltipContent>Only visible in developer mode</TooltipContent>
      </Tooltip>
    </div>
  );
}
