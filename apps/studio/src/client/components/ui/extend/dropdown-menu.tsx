import {
  useBaseUiPortalContainer,
  useZoomStyle,
} from "@/client/components/ui/extend/studio-integration";
import { cn } from "@/client/lib/utils";
import { Menu as DropdownMenuPrimitive } from "@base-ui/react/menu";
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: portal target and CSS `zoom` wired to Studio's app zoom, and
// the viewport's `--available-height` divided by `--content-zoom` so the
// popup's self-applied zoom doesn't double-count it.
import * as React from "react";

function childContent(
  asChild: boolean | undefined,
  children: React.ReactNode,
): React.ReactNode {
  return asChild && React.isValidElement(children) ? undefined : children;
}

function DropdownMenu({
  ...props
}: DropdownMenuPrimitive.Root.Props): React.ReactElement {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuCheckboxItem({
  checked,
  children,
  className,
  variant = "default",
  ...props
}: DropdownMenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-sm py-1 pe-2 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-accent data-highlighted:text-accent-foreground sm:min-h-7 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        variant === "default" && "ps-8",
        variant === "switch" && "justify-between ps-2",
        className,
      )}
      data-slot="dropdown-menu-checkbox-item"
      data-variant={variant}
      {...props}
    >
      {variant === "switch" ? null : (
        <span className="pointer-events-none absolute start-2 flex size-4 items-center justify-center">
          <DropdownMenuPrimitive.CheckboxItemIndicator>
            <HugeiconsIcon icon={Tick02Icon} />
          </DropdownMenuPrimitive.CheckboxItemIndicator>
        </span>
      )}
      {children}
      {variant === "switch" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none relative ms-4 inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input transition-colors data-[checked=true]:bg-primary"
          data-checked={checked ? "true" : "false"}
        >
          <span
            className="size-3 translate-x-0.5 rounded-full bg-background shadow-xs transition-transform data-[checked=true]:translate-x-3.5"
            data-checked={checked ? "true" : "false"}
          />
        </span>
      ) : null}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  anchor,
  children,
  className,
  portalProps,
  side = "bottom",
  sideOffset = 4,
  style,
  ...props
}: DropdownMenuPrimitive.Popup.Props & {
  align?: DropdownMenuPrimitive.Positioner.Props["align"];
  alignOffset?: DropdownMenuPrimitive.Positioner.Props["alignOffset"];
  anchor?: DropdownMenuPrimitive.Positioner.Props["anchor"];
  portalProps?: DropdownMenuPrimitive.Portal.Props;
  side?: DropdownMenuPrimitive.Positioner.Props["side"];
  sideOffset?: DropdownMenuPrimitive.Positioner.Props["sideOffset"];
}): React.ReactElement {
  const portalContainer = useBaseUiPortalContainer();

  return (
    <DropdownMenuPrimitive.Portal
      {...portalProps}
      container={portalProps?.container ?? portalContainer}
    >
      <DropdownMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        data-slot="dropdown-menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <DropdownMenuPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) min-w-32 origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-lg/5 transition-[width,height,scale,opacity] outline-none not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          data-slot="dropdown-menu-content"
          style={useZoomStyle(style)}
          {...props}
        >
          <DropdownMenuPrimitive.Viewport
            className="relative size-full max-h-[calc(var(--available-height)/var(--content-zoom))] overflow-y-auto p-1 data-instant:transition-none"
            data-slot="dropdown-menu-viewport"
          >
            {children}
          </DropdownMenuPrimitive.Viewport>
        </DropdownMenuPrimitive.Popup>
      </DropdownMenuPrimitive.Positioner>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  ...props
}: DropdownMenuPrimitive.Group.Props): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  );
}

function DropdownMenuItem({
  asChild,
  children,
  className,
  inset,
  render,
  variant = "default",
  ...props
}: DropdownMenuPrimitive.Item.Props & {
  asChild?: boolean;
  inset?: boolean;
  variant?: "default" | "destructive";
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 py-1 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[inset=true]:ps-8 data-[variant=destructive]:text-destructive-foreground sm:min-h-7 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      data-inset={inset}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      render={
        render ??
        (asChild && React.isValidElement(children)
          ? (children as React.ReactElement<Record<string, unknown>>)
          : undefined)
      }
      {...props}
    >
      {childContent(asChild, children)}
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: DropdownMenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.GroupLabel
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground data-[inset=true]:ps-8",
        className,
      )}
      data-inset={inset}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

function DropdownMenuPortal({
  ...props
}: DropdownMenuPrimitive.Portal.Props): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  );
}

function DropdownMenuRadioGroup({
  ...props
}: DropdownMenuPrimitive.RadioGroup.Props): React.ReactElement {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  children,
  className,
  ...props
}: DropdownMenuPrimitive.RadioItem.Props): React.ReactElement {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "relative flex min-h-8 cursor-default items-center gap-2 rounded-sm py-1 ps-8 pe-2 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-accent data-highlighted:text-accent-foreground sm:min-h-7 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      <span className="pointer-events-none absolute start-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.RadioItemIndicator>
          <span className="size-2 rounded-full bg-current" />
        </DropdownMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: DropdownMenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">): React.ReactElement {
  return (
    <span
      className={cn(
        "ms-auto text-xs font-medium text-muted-foreground",
        className,
      )}
      data-slot="dropdown-menu-shortcut"
      {...props}
    />
  );
}

function DropdownMenuSub({
  ...props
}: DropdownMenuPrimitive.SubmenuRoot.Props): React.ReactElement {
  return (
    <DropdownMenuPrimitive.SubmenuRoot
      data-slot="dropdown-menu-sub"
      {...props}
    />
  );
}

function DropdownMenuSubContent(
  props: React.ComponentProps<typeof DropdownMenuContent>,
): React.ReactElement {
  return <DropdownMenuContent side="right" sideOffset={8} {...props} />;
}

function DropdownMenuSubTrigger({
  children,
  className,
  inset,
  ...props
}: DropdownMenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.SubmenuTrigger
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 py-1 text-base outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-popup-open:bg-accent data-[inset=true]:ps-8 sm:min-h-7 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      data-inset={inset}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    >
      {children}
      <HugeiconsIcon className="ms-auto size-4" icon={ArrowRight01Icon} />
    </DropdownMenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuTrigger({
  asChild,
  children,
  render,
  ...props
}: DropdownMenuPrimitive.Trigger.Props & {
  asChild?: boolean;
}): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      render={
        render ??
        (asChild && React.isValidElement(children)
          ? (children as React.ReactElement<Record<string, unknown>>)
          : undefined)
      }
      {...props}
    >
      {childContent(asChild, children)}
    </DropdownMenuPrimitive.Trigger>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
