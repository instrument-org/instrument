import { cn } from "@/client/lib/utils";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
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
      className={cn("cursor-default", className)}
      data-slot="collapsible-trigger"
      {...rest}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
