import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { type ComponentProps } from "react";

/**
 * The product's call to action: a white button carrying the mark and a verb.
 * Its words are the message: clicking one sends them to the conversation,
 * which is how everything on a screen asks Instrument for something. Never a
 * form, never a setting.
 */
export function GlyphButton({
  children,
  className,
  size = "md",
  ...rest
}: ComponentProps<"button"> & { size?: "md" | "sm" }) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card font-medium text-foreground shadow-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
        className,
      )}
      type="button"
      {...rest}
    >
      <InstrumentGlyph
        className={cn(
          "shrink-0 text-brand-600 dark:text-brand-400",
          size === "sm" ? "size-3.5" : "size-4",
        )}
      />
      <span className="truncate">{children}</span>
    </button>
  );
}
