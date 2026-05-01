import type { ReactNode } from "react";
import type {
  GroupProps,
  PanelProps,
  SeparatorProps,
} from "react-resizable-panels";

import { cn } from "@/client/lib/utils";
import { Group, Panel, Separator } from "react-resizable-panels";

function ResizableHandle({
  children,
  className,
  ...props
}: SeparatorProps & { children?: ReactNode }) {
  return (
    <Separator
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center",
        "bg-transparent transition-colors duration-200",
        "outline-none",
        "after:absolute after:transition-all after:duration-200",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        "aria-[orientation=horizontal]:cursor-row-resize",
        "aria-[orientation=horizontal]:after:inset-x-2 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-0.5 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-px",
        "aria-[orientation=vertical]:cursor-col-resize",
        "aria-[orientation=vertical]:after:inset-y-2 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-0.5 aria-[orientation=vertical]:after:-translate-x-1/2",
        "after:rounded-full after:bg-transparent",
        "data-[separator=hover]:after:bg-muted-foreground/50",
        "data-[separator=active]:after:bg-primary/50",
        "aria-[orientation=vertical]:data-[separator=hover]:after:scale-x-[3]",
        "aria-[orientation=horizontal]:data-[separator=hover]:after:scale-y-[3]",
        "data-[separator=disabled]:cursor-not-allowed data-[separator=disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </Separator>
  );
}

function ResizablePanel({ className, style, ...props }: PanelProps) {
  return (
    <Panel
      className={cn("h-full min-h-0", className)}
      style={{ ...style, overflow: "hidden" }}
      {...props}
    />
  );
}

function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
