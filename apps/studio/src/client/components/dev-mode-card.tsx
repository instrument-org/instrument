import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";

// Shared shell for developer-mode-only regions: a dashed, muted card. Pairs with
// DevModeCardHeader for the badge-led header used across debug peeks (injected
// model context) and the system-prompt viewer.
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
