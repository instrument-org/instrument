import { cn } from "@/client/lib/utils";
import { SealCheckIcon } from "@phosphor-icons/react";

export function FoundingUserLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>Founding User</span>
      <SealCheckIcon aria-hidden className="size-3 shrink-0 text-brand-300" />
    </span>
  );
}
