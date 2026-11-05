import { PopoverContent } from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { type CSSProperties, type ReactNode } from "react";

/** A floating panel in the window's theme, rising from what opened it. */
export function StripPopover({
  align,
  children,
  className,
  style,
}: {
  align: "end" | "start";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <PopoverContent
      align={align}
      // Off the window's edge, which the band's first cell starts at.
      alignOffset={align === "start" ? 8 : 0}
      className={cn(
        "rounded-lg border p-0 font-mono text-[11px] shadow-xl select-text",
        className,
      )}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
      }}
      side="top"
      style={style}
    >
      {children}
    </PopoverContent>
  );
}

export function StripHeading({
  children,
  end,
}: {
  children: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b px-3 text-muted-foreground select-none">
      <span className="min-w-0 truncate">{children}</span>
      {end && <span className="flex shrink-0 items-center gap-3">{end}</span>}
    </div>
  );
}
