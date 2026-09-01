"use client";

import { useAppZoomStyle, zoomMaxSize } from "@/client/hooks/use-app-zoom";
import { useChromeCollisionPadding } from "@/client/hooks/use-chrome-inset";
import { usePortalContainer } from "@/client/hooks/use-portal-container";
import { cn } from "@/client/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipContent({
  children,
  className,
  collisionPadding,
  maxWidth = "20rem",
  sideOffset = 6,
  style,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  /** Intrinsic width the tooltip wants, capped by the window. */
  maxWidth?: string;
}) {
  const container = usePortalContainer();
  const chromeCollisionPadding = useChromeCollisionPadding();

  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        // Wrapping stays plain rather than balanced: `w-fit` resolves to the
        // max-width cap before lines are balanced, so a tooltip that wraps at
        // all keeps the full width with half of it left empty.
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-popover px-3 py-1.5 text-xs text-pretty text-popover-foreground shadow-md fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        collisionPadding={collisionPadding ?? chromeCollisionPadding}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        style={useAppZoomStyle({
          ...style,
          maxWidth: zoomMaxSize("width", maxWidth),
        })}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

function TooltipProvider({
  delayDuration,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onFocus={(event) => {
        onFocus?.(event);
        // Radix opens on focus, and a menu or dialog hands focus back to
        // whatever opened it when it closes: the tooltip returns over a choice
        // the user has just finished making, uninvited. A visible focus is the
        // arrival that did ask for it, since reading a control is all a
        // keyboard user can do before acting on it. Preventing the default is
        // how Radix's composed handler is told to stay out of this one.
        if (!event.currentTarget.matches(":focus-visible")) {
          event.preventDefault();
        }
      }}
      {...props}
    />
  );
}

const TooltipRoot = TooltipPrimitive.Root;

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
};
