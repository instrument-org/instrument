import { PopoverContent } from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { type CSSProperties, type ReactNode } from "react";

/** A floating panel in the band's own ink, rising from what opened it. */
export function InkPopover({
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
      className={cn(
        "rounded-lg border border-white/12 bg-ink p-0 font-mono text-[11px] text-white/90 shadow-2xl select-text",
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

export function InkHeading({
  children,
  end,
}: {
  children: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-white/8 px-3 text-white/50 select-none">
      <span className="min-w-0 truncate">{children}</span>
      {end && <span className="flex shrink-0 items-center gap-3">{end}</span>}
    </div>
  );
}
