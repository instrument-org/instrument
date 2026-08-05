import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react";
import { MessageScroller as MessageScrollerPrimitive } from "@shadcn/react/message-scroller";
import * as React from "react";

import { Button } from "./button";
import { Spinner } from "./spinner";

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
// self-disables (inert, hidden) when there is nothing to scroll toward. `busy`
// rings the button with a spinner, so a reader scrolled away from the end can
// see that content is still arriving there; the caret stays put underneath it,
// since the button does the same thing either way.
function MessageScrollerButton({
  busy = false,
  children,
  className,
  direction = "end",
  render,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> & {
  busy?: boolean;
}) {
  return (
    <MessageScrollerPrimitive.Button
      className={cn(
        "relative rounded-full bg-background hover:bg-background/90 data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        // The spinner ring stands in for the elevation hairline while busy;
        // the soft shadow drops that hairline so the two never stack as
        // concentric rings.
        busy ? "shadow-lg-soft" : "shadow-lg",
        className,
      )}
      data-slot="message-scroller-button"
      direction={direction}
      render={render ?? <Button size="icon-sm" variant="secondary" />}
      {...props}
    >
      {children ?? (
        <>
          <CaretDownIcon
            className={cn("size-3", direction === "start" && "rotate-180")}
          />
          {busy ? (
            // The ring's outer edge is its box's edge, so overhanging the
            // button by the hairline's 1px lands it exactly where the
            // elevation ring sits at rest.
            <Spinner
              className="pointer-events-none absolute -inset-px size-auto text-muted-foreground"
              thickness={1.5}
            />
          ) : null}
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

// The transcript is not a tab stop and never draws a focus ring. It is a
// reading surface, and a stop that shows nothing on arrival is worse than no
// stop at all. Clicking still focuses it, so the arrow keys scroll it as soon
// as a reader is in it; the ring that would otherwise follow that click is
// what `outline-none` drops.
function MessageScrollerViewport({
  className,
  tabIndex = -1,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      className={cn(
        "size-full min-h-0 min-w-0 scrollbar-thin scrollbar-color overflow-y-auto overscroll-contain outline-none",
        className,
      )}
      data-slot="message-scroller-viewport"
      tabIndex={tabIndex}
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
