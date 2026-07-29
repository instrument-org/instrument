import {
  type ClickActivation,
  immediateClickHandlers,
} from "@/client/lib/immediate-click";
import { cn } from "@/client/lib/utils";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleContent({
  animated = false,
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent> & {
  animated?: boolean;
}) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      className={cn(
        // Clipping is what a height animation needs and what static content
        // does not: it cuts off anything the content paints past its box, like
        // the shadow under a button sitting at the bottom edge.
        animated &&
          "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className,
      )}
      data-slot="collapsible-content"
      {...props}
    />
  );
}

function CollapsibleTrigger({
  activation,
  className,
  onClick,
  onPointerDown,
  ...rest
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger> & {
  activation?: ClickActivation;
}) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      className={cn("cursor-default select-none", className)}
      data-slot="collapsible-trigger"
      {...immediateClickHandlers<HTMLButtonElement>({
        activation,
        onClick,
        onPointerDown,
      })}
      {...rest}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
