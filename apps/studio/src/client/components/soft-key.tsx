import { type ReactNode } from "react";

/** A key printed beside the control it works, in a light keycap. */
export function SoftKey({ children }: { children: ReactNode }) {
  return (
    <span
      data-slot="soft-key"
      className="inline-flex h-4.5 shrink-0 items-center rounded-[4px] bg-foreground/[0.04] px-1 font-sans text-[11px] font-medium text-muted-foreground/70 ring-1 ring-foreground/[0.06]"
    >
      {children}
    </span>
  );
}
