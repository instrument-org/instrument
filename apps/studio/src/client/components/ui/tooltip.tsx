"use client";

import { useAppZoomStyle, zoomMaxSize } from "@/client/hooks/use-app-zoom";
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
  arrow,
  arrowClassName,
  children,
  className,
  maxWidth = "20rem",
  sideOffset = 0,
  style,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  arrow?: React.ReactNode;
  arrowClassName?: string;
  /** Intrinsic width the tooltip wants, capped by the window. */
  maxWidth?: string;
}) {
  const container = usePortalContainer();

  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        // Wrapping stays plain rather than balanced: `w-fit` resolves to the
        // max-width cap before lines are balanced, so a tooltip that wraps at
        // all keeps the full width with half of it left empty.
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-pretty text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        style={useAppZoomStyle({
          ...style,
          maxWidth: zoomMaxSize("width", maxWidth),
        })}
        {...props}
      >
        {children}
        {arrow === undefined ? (
          <TooltipPrimitive.Arrow
            className={cn(
              "z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground",
              arrowClassName,
            )}
          />
        ) : (
          <TooltipPrimitive.Arrow asChild>{arrow}</TooltipPrimitive.Arrow>
        )}
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
