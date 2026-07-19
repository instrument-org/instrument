// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths only.
import type React from "react";

import { cn } from "@/client/lib/utils";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { isValidElement } from "react";

export function Collapsible({
  ...props
}: CollapsiblePrimitive.Root.Props): React.ReactElement {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsiblePanel({
  className,
  forceMount: _forceMount,
  ...props
}: CollapsiblePrimitive.Panel.Props & {
  forceMount?: boolean;
}): React.ReactElement {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0",
        className,
      )}
      data-slot="collapsible-panel"
      {...props}
    />
  );
}

export function CollapsibleTrigger({
  asChild,
  children,
  className,
  render,
  ...props
}: CollapsiblePrimitive.Trigger.Props & {
  asChild?: boolean;
}): React.ReactElement {
  return (
    <CollapsiblePrimitive.Trigger
      className={className}
      data-slot="collapsible-trigger"
      render={
        render ??
        (asChild && isValidElement(children)
          ? (children as React.ReactElement<Record<string, unknown>>)
          : undefined)
      }
      {...props}
    >
      {asChild && isValidElement(children) ? undefined : children}
    </CollapsiblePrimitive.Trigger>
  );
}

export { CollapsiblePanel as CollapsibleContent };

export { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
