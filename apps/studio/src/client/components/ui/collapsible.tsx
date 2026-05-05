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
        "overflow-hidden",
        animated &&
          "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className,
      )}
      data-slot="collapsible-content"
      {...props}
    />
  );
}

function CollapsibleTrigger({
  className,
  ...rest
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      className={cn("cursor-default select-none", className)}
      data-slot="collapsible-trigger"
      {...rest}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
