import { cn } from "@/client/lib/utils";

import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";

export function ModelContextDebugCard({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/30 p-2",
        className,
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <DeveloperModeBadge />
        <span className="text-[10px] leading-tight text-muted-foreground">
          Injected into prompt.
        </span>
      </div>
      <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    </div>
  );
}
