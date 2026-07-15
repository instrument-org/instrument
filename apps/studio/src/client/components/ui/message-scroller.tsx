import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react";
import { MessageScroller as MessageScrollerPrimitive } from "@shadcn/react/message-scroller";
import * as React from "react";

import { Button } from "./button";

/* eslint-disable react-refresh/only-export-components -- re-export scroller hooks from the primitive */
export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
/* eslint-enable react-refresh/only-export-components */

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      data-slot="message-scroller"
      {...props}
    />
  );
}

// Positioning is left to the caller; this only styles the control. It
// self-disables (inert, hidden) when there is nothing to scroll toward.
function MessageScrollerButton({
  children,
  className,
  direction = "end",
  render,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      className={cn(
        "rounded-full bg-background shadow-lg hover:bg-background/90 data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        className,
      )}
      data-slot="message-scroller-button"
      direction={direction}
      render={render ?? <Button size="icon-sm" variant="secondary" />}
      {...props}
    >
      {children ?? (
        <>
          <CaretDownIcon className="size-3" />
          <span className="sr-only">
            {direction === "end" ? "Scroll to latest" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      className={cn("flex h-max flex-col gap-6", className)}
      data-slot="message-scroller-content"
      {...props}
    />
  );
}

// Rows deliberately avoid `content-visibility`/`contain-intrinsic-size`: paint
// containment clips content that overflows a row horizontally (hover chrome,
// shadows), which we need to stay visible.
function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      className={cn("min-w-0 shrink-0", className)}
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      {...props}
    />
  );
}

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-color",
        className,
      )}
      data-slot="message-scroller-viewport"
      {...props}
    />
  );
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
};
