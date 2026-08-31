"use client";

import { useAppZoomStyle } from "@/client/hooks/use-app-zoom";
import { useChromeCollisionPadding } from "@/client/hooks/use-chrome-inset";
import { usePortalContainer } from "@/client/hooks/use-portal-container";
import { cn } from "@/client/lib/utils";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * The room Radix measured between the trigger and the edge of what the popover
 * may cover, in the layout px this content is laid out in: Radix reports it in
 * on-screen px, and the content re-applies zoom to its own units.
 *
 * The window stands in for it until it has been measured, which is not merely
 * belt and braces: Radix publishes the variable from a layout effect, so it is
 * undefined for the first paint, and a `max-height` reading an undefined
 * variable is not a loose cap but no cap at all. Content that measures itself
 * against that first paint -- a virtualized list asking how much of it is on
 * screen -- reads an unbounded box and renders all of itself into it.
 */
const AVAILABLE_HEIGHT =
  "calc(var(--radix-popover-content-available-height, 100vh) / var(--content-zoom))";

function PopoverContent({
  align = "center",
  className,
  collisionPadding,
  maxHeight,
  sideOffset = 4,
  style,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /** Intrinsic height the popover wants, capped by the room it has. */
  maxHeight?: string;
}) {
  const container = usePortalContainer();
  const chromeCollisionPadding = useChromeCollisionPadding();

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        align={align}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl bg-popover p-4 text-popover-foreground shadow-sm outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        collisionPadding={collisionPadding ?? chromeCollisionPadding}
        data-slot="popover-content"
        sideOffset={sideOffset}
        // An inline height rather than a class, because a class is the one form
        // of this a caller can take away without meaning to: `cn()` merges a
        // `max-h-*` over the primitive's own and the room cap leaves with it,
        // which looks right until the window is short or the UI is zoomed in.
        // So the size a popover wants comes in as `maxHeight` instead.
        style={useAppZoomStyle({
          ...style,
          maxHeight: maxHeight
            ? `min(${maxHeight}, ${AVAILABLE_HEIGHT})`
            : AVAILABLE_HEIGHT,
        })}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
