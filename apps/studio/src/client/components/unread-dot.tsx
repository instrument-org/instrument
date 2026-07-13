import { cn } from "@/client/lib/utils";

// A small unread dot. Defaults to the brand color at 6px so it reads as a light
// accent rather than the heavier full-contrast dot. Override via `className`.
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      aria-label="Unread"
      className={cn("block size-1.5 rounded-full bg-brand-400", className)}
      role="status"
    />
  );
}
