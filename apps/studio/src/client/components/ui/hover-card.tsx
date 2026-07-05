import { useAppZoomStyle } from "@/client/hooks/use-app-zoom";
import { usePortalContainer } from "@/client/hooks/use-portal-container";
import { cn } from "@/client/lib/utils";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import * as React from "react";

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardContent({
  align = "center",
  className,
  sideOffset = 4,
  style,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  const container = usePortalContainer();

  return (
    <HoverCardPrimitive.Portal
      container={container}
      data-slot="hover-card-portal"
    >
      <HoverCardPrimitive.Content
        align={align}
        className={cn(
          "z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        data-slot="hover-card-content"
        sideOffset={sideOffset}
        style={useAppZoomStyle(style)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
