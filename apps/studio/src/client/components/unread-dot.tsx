import { cn } from "@/client/lib/utils";

// A small unread dot. Defaults to `bg-muted-foreground` so it reads as a soft
// gray that still adapts to the surface (darker on light, lighter on dark)
// without the harshness of full foreground contrast. Override via `className`.
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      aria-label="Unread"
      className={cn("block size-2 rounded-full bg-muted-foreground", className)}
      role="status"
    />
  );
}
