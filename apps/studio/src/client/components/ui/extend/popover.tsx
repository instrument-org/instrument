// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: portal target and CSS `zoom` wired to Studio's app zoom, and
// the viewport's `--available-height` divided by `--content-zoom` so the
// popup's self-applied zoom doesn't double-count it.
import type React from "react";

import {
  useBaseUiPortalContainer,
  useZoomStyle,
} from "@/client/components/ui/extend/studio-integration";
import { cn } from "@/client/lib/utils";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { isValidElement } from "react";

export const PopoverCreateHandle: typeof PopoverPrimitive.createHandle =
  PopoverPrimitive.createHandle;

export const Popover: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;

export function PopoverAnchor(
  props: React.ComponentProps<"span">,
): React.ReactElement {
  return <span data-slot="popover-anchor" {...props} />;
}

export function PopoverClose({
  ...props
}: PopoverPrimitive.Close.Props): React.ReactElement {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props): React.ReactElement {
  return (
    <PopoverPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      data-slot="popover-description"
      {...props}
    />
  );
}

export function PopoverPopup({
  align = "center",
  alignOffset = 0,
  anchor,
  children,
  className,
  portalProps,
  side = "bottom",
  sideOffset = 4,
  style,
  tooltipStyle = false,
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props["align"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  portalProps?: PopoverPrimitive.Portal.Props;
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  tooltipStyle?: boolean;
}): React.ReactElement {
  const portalContainer = useBaseUiPortalContainer();

  return (
    <PopoverPrimitive.Portal
      {...portalProps}
      container={portalProps?.container ?? portalContainer}
    >
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-lg/5 transition-[width,height,scale,opacity] outline-none not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] data-starting-style:scale-98 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            tooltipStyle &&
              "w-fit rounded-md text-xs text-balance shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]",
            className,
          )}
          data-slot="popover-popup"
          style={useZoomStyle(style)}
          {...props}
        >
          <PopoverPrimitive.Viewport
            className={cn(
              "relative size-full max-h-[calc(var(--available-height)/var(--content-zoom))] overflow-clip px-(--viewport-inline-padding) py-4 [--viewport-inline-padding:--spacing(4)] has-data-[slot=calendar]:p-2 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-current:transition-opacity **:data-current:data-ending-style:opacity-0 data-instant:transition-none **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:opacity-100 **:data-previous:transition-opacity **:data-previous:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-starting-style:opacity-0",
              tooltipStyle
                ? "py-1 [--viewport-inline-padding:--spacing(2)]"
                : "not-data-transitioning:overflow-y-auto",
            )}
            data-slot="popover-viewport"
          >
            {children}
          </PopoverPrimitive.Viewport>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export function PopoverTitle({
  className,
  ...props
}: PopoverPrimitive.Title.Props): React.ReactElement {
  return (
    <PopoverPrimitive.Title
      className={cn("text-lg leading-none font-semibold", className)}
      data-slot="popover-title"
      {...props}
    />
  );
}

export function PopoverTrigger({
  asChild,
  children,
  className,
  render,
  ...props
}: PopoverPrimitive.Trigger.Props & {
  asChild?: boolean;
}): React.ReactElement {
  return (
    <PopoverPrimitive.Trigger
      className={className}
      data-slot="popover-trigger"
      render={
        render ??
        (asChild && isValidElement(children)
          ? (children as React.ReactElement<Record<string, unknown>>)
          : undefined)
      }
      {...props}
    >
      {asChild && isValidElement(children) ? undefined : children}
    </PopoverPrimitive.Trigger>
  );
}

export { PopoverPopup as PopoverContent };

export { Popover as PopoverPrimitive } from "@base-ui/react/popover";
