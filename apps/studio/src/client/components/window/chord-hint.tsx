import { Kbd } from "@/client/components/ui/kbd";
import { cn } from "@/client/lib/utils";

/**
 * The keys that pick a tab or a group, in a small dark pill, while their
 * modifier is held (`heldHintAtom`). It fades in, and appears at once for
 * reduced motion.
 */
export function ChordHint({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <Kbd
      className={cn(
        "z-20 h-5 rounded-md bg-foreground px-1.5 text-[11px] font-semibold text-background shadow-sm transition-opacity duration-100 motion-reduce:transition-none starting:opacity-0",
        className,
      )}
      data-chord-hint=""
    >
      {children}
    </Kbd>
  );
}
