// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: portal target and CSS `zoom` wired to Studio's app zoom.
import type React from "react";

import {
  useBaseUiPortalContainer,
  useZoomStyle,
} from "@/client/components/ui/extend/studio-integration";
import { cn } from "@/client/lib/utils";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { isValidElement } from "react";

export const TooltipCreateHandle: typeof TooltipPrimitive.createHandle =
  TooltipPrimitive.createHandle;

export function TooltipProvider({
  delayDuration,
  delay = delayDuration,
  ...props
}: TooltipPrimitive.Provider.Props & {
  delayDuration?: TooltipPrimitive.Provider.Props["delay"];
}): React.ReactElement {
  return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

export const Tooltip: typeof TooltipPrimitive.Root = TooltipPrimitive.Root;

export function TooltipPopup({
  align = "center",
  anchor,
  children,
  className,
  portalProps,
  side = "top",
  sideOffset = 4,
  style,
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
  portalProps?: TooltipPrimitive.Portal.Props;
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
}): React.ReactElement {
  const portalContainer = useBaseUiPortalContainer();

  return (
    <TooltipPrimitive.Portal
      {...portalProps}
      container={portalProps?.container ?? portalContainer}
    >
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-md border bg-popover text-xs text-balance text-popover-foreground shadow-md/5 transition-[width,height,scale,opacity] not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-98 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          data-slot="tooltip-popup"
          style={useZoomStyle(style)}
          {...props}
        >
          <TooltipPrimitive.Viewport
            className="relative size-full overflow-clip px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-current:transition-opacity **:data-current:data-ending-style:opacity-0 data-instant:transition-none **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-previous:opacity-100 **:data-previous:transition-opacity **:data-previous:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-starting-style:opacity-0"
            data-slot="tooltip-viewport"
          >
            {children}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export function TooltipTrigger({
  asChild,
  children,
  render,
  ...props
}: TooltipPrimitive.Trigger.Props & {
  asChild?: boolean;
}): React.ReactElement {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      render={
        render ??
        (asChild && isValidElement(children)
          ? (children as React.ReactElement<Record<string, unknown>>)
          : undefined)
      }
      {...props}
    >
      {asChild && isValidElement(children) ? undefined : children}
    </TooltipPrimitive.Trigger>
  );
}

export { TooltipPopup as TooltipContent };

export { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
