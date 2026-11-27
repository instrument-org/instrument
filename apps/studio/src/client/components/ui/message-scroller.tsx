import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import * as React from "react";

import { Button } from "./button";
import { FarRows } from "./scroll-owner/far-rows";
import { FarRowsContext } from "./scroll-owner/far-rows-context";
import { type ScrollOptions, ScrollOwner } from "./scroll-owner/scroll-owner";
import { Spinner } from "./spinner";

const ScrollOwnerContext = React.createContext<ScrollOwner | null>(null);

function useScrollOwner(): ScrollOwner {
  const owner = React.use(ScrollOwnerContext);
  if (!owner) {
    throw new Error("A message scroller part must be inside its provider.");
  }
  return owner;
}

/** The transcript's turns far from view, and where and how tall each row is. */
function useFarRows(): FarRows {
  const farRows = React.use(FarRowsContext);
  if (!farRows) {
    throw new Error("A message scroller part must be inside its provider.");
  }
  return farRows;
}

/** The commands a transcript's controls reach the scroller through. */
function useMessageScroller(): {
  armSlide: () => void;
  releaseAutoScroll: () => void;
  scrollToEnd: (options?: { behavior?: ScrollBehavior }) => boolean;
  scrollToMessage: (messageId: string, options?: ScrollOptions) => boolean;
  scrollToStart: () => boolean;
} {
  const owner = useScrollOwner();
  return {
    armSlide: owner.armSlide,
    releaseAutoScroll: owner.releaseAutoScroll,
    scrollToEnd: owner.scrollToEnd,
    scrollToMessage: owner.scrollToMessage,
    scrollToStart: owner.scrollToStart,
  };
}

/**
 * Holds the row `target` points at still on screen while `hold` is set, so
 * what changes above it scrolls away (`ScrollOwner.holdPin`). Where the row is
 * is read before the render that sets `hold` changes anything, which only a
 * class's `getSnapshotBeforeUpdate` can do. Draws nothing, and does nothing
 * outside a scroller.
 */
class ScrollPin extends React.Component<{
  hold: boolean;
  target: React.RefObject<HTMLElement | null>;
}> {
  static override contextType = ScrollOwnerContext;
  declare context: ScrollOwner | null;
  private held: HTMLElement | null = null;
  private isMounted = false;

  override componentDidMount() {
    this.isMounted = true;
    if (this.props.hold) {
      // A row that comes held (an answer that arrives as its turn ends) gets
      // its ref only after its children mount, so this waits for the commit
      // to finish, which is still before the owner next measures.
      queueMicrotask(() => {
        if (this.isMounted && this.props.hold && !this.held) {
          this.start(undefined);
        }
      });
    }
  }

  override getSnapshotBeforeUpdate(previous: { hold: boolean }) {
    const element = this.props.target.current;
    return !previous.hold && this.props.hold && element
      ? (this.context?.screenTopOf(element) ?? null)
      : null;
  }

  override componentDidUpdate(
    previous: { hold: boolean },
    _state: unknown,
    screenTop: number | null,
  ) {
    if (previous.hold === this.props.hold) {
      return;
    }
    if (this.props.hold) {
      this.start(screenTop ?? undefined);
    } else {
      this.stop();
    }
  }

  override componentWillUnmount() {
    this.isMounted = false;
    this.stop();
  }

  private start(screenTop: number | undefined) {
    const element = this.props.target.current;
    if (!element || !this.context) {
      return;
    }
    this.held = element;
    this.context.holdPin(element, screenTop);
  }

  private stop() {
    if (this.held) {
      this.context?.releasePin(this.held);
      this.held = null;
    }
  }

  override render() {
    return null;
  }
}

/** Whether there is more to scroll to at the start and at the end. */
function useMessageScrollerScrollable() {
  const owner = useScrollOwner();
  return React.useSyncExternalStore(
    owner.subscribe,
    owner.getScrollable,
    owner.getScrollable,
  );
}

/**
 * Owns a transcript's scroll position (`ScrollOwner`). `autoScroll` says
 * whether anything can still arrive at the end, so following it means
 * anything; `scrollPreviousItemPeek` is the room left above a message just
 * sent, so the end of what came before stays in sight.
 */
function MessageScrollerProvider({
  autoScroll = false,
  children,
  defaultScrollPosition = "end",
  scrollPreviousItemPeek = 64,
}: {
  autoScroll?: boolean;
  children?: React.ReactNode;
  /** Where the transcript opens, read once. */
  defaultScrollPosition?: "end" | "start";
  scrollPreviousItemPeek?: number;
}) {
  const [owner] = React.useState(
    () =>
      new ScrollOwner(
        { anchorRoom: scrollPreviousItemPeek, autoScroll },
        defaultScrollPosition,
      ),
  );
  const [farRows] = React.useState(() => new FarRows(owner.holds));
  const isShown = useIsActiveTab();
  React.useLayoutEffect(() => {
    owner.updateSettings({ anchorRoom: scrollPreviousItemPeek, autoScroll });
  }, [owner, autoScroll, scrollPreviousItemPeek]);
  React.useLayoutEffect(() => {
    farRows.setShown(isShown);
  }, [farRows, isShown]);
  React.useEffect(() => {
    owner.connect();
    farRows.connect();
    return () => {
      owner.dispose();
      farRows.dispose();
    };
  }, [farRows, owner]);
  return (
    <ScrollOwnerContext value={owner}>
      <FarRowsContext value={farRows}>{children}</FarRowsContext>
    </ScrollOwnerContext>
  );
}

function MessageScroller({
  className,
  ref,
  ...props
}: React.ComponentProps<"div">) {
  const owner = useScrollOwner();
  const attach = useAttach(owner.setRoot, ref);
  return (
    <div
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      data-slot="message-scroller"
      ref={attach}
      {...props}
    />
  );
}

// Positioning is left to the caller; this only styles the control. It
// self-disables (inert, hidden) when there is nothing to scroll toward. `busy`
// rings the button with a spinner, so a reader scrolled away from the end can
// see that content is still arriving there; the caret stays put underneath it,
// since the button does the same thing either way. `waiting` puts a dot on its
// corner instead, for a question down there that the work is stopped on.
function MessageScrollerButton({
  busy = false,
  children,
  className,
  direction = "end",
  onClick,
  waiting = false,
  ...props
}: React.ComponentProps<typeof Button> & {
  busy?: boolean;
  direction?: "end" | "start";
  waiting?: boolean;
}) {
  const owner = useScrollOwner();
  const scrollable = useMessageScrollerScrollable();
  const isActive = direction === "start" ? scrollable.start : scrollable.end;
  return (
    <Button
      className={cn(
        "relative rounded-full bg-background hover:bg-background/90 data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        // Spelled as a variable so `cn` knows it for a shadow and drops the
        // button's own `shadow-xs`, whose translucent rings would otherwise
        // sit outside the edge below.
        "shadow-(--shadow-lg-soft)",
        // The elevation hairline, mixed to an opaque color rather than drawn
        // translucent: the button floats over the transcript, and a see-through
        // edge shows every line scrolling under it. The busy spinner draws
        // over this same pixel, so its faint track and the fading tail of its
        // arc land on the hairline rather than on the transcript.
        "ring-1 ring-[color-mix(in_oklab,var(--foreground)_6%,var(--background))] dark:ring-[color-mix(in_oklab,var(--foreground)_11%,var(--background))]",
        className,
      )}
      data-active={isActive ? "true" : "false"}
      data-slot="message-scroller-button"
      inert={!isActive}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        event.currentTarget.blur();
        if (direction === "start") {
          owner.scrollToStart();
        } else {
          owner.scrollToEnd({ behavior: "smooth" });
        }
      }}
      size="icon-sm"
      tabIndex={isActive ? undefined : -1}
      type="button"
      variant="secondary"
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
              delay={0}
              thickness={1.5}
            />
          ) : null}
          {waiting ? (
            <span className="pointer-events-none absolute -top-0.5 -right-0.5 size-2 rounded-full bg-foreground/70 ring-2 ring-background" />
          ) : null}
          <span className="sr-only">
            {direction === "end" ? "Scroll to latest" : "Scroll to start"}
          </span>
        </>
      )}
    </Button>
  );
}

/**
 * The transcript's column. Its last child is the room the scroller leaves under
 * a message just sent, so the reply has somewhere to arrive.
 */
function MessageScrollerContent({
  children,
  className,
  ref,
  ...props
}: React.ComponentProps<"div">) {
  const owner = useScrollOwner();
  const attach = useAttach(owner.setContent, ref);
  const attachSpacer = useAttach(owner.setSpacer);
  return (
    <div
      aria-relevant="additions"
      className={cn("flex h-max flex-col gap-6", className)}
      data-slot="message-scroller-content"
      ref={attach}
      role="log"
      {...props}
    >
      {children}
      <div
        aria-hidden="true"
        data-message-scroller-spacer=""
        hidden
        ref={attachSpacer}
      />
    </div>
  );
}

// Rows deliberately avoid `content-visibility`/`contain-intrinsic-size`: paint
// containment clips content that overflows a row horizontally (hover chrome,
// shadows), which we need to stay visible. A turn far from view is a box of
// its last height instead (`FarRows`), the row itself staying as it is.
function MessageScrollerItem({
  children,
  className,
  keepDrawn = false,
  messageId,
  ref,
  scrollAnchor = false,
  style,
  turnId,
  ...props
}: React.ComponentProps<"div"> & {
  /** Never drawn as a box, however far from view. */
  keepDrawn?: boolean;
  /** Names the row, for `scrollToMessage`. */
  messageId?: string;
  /** A message the person sent, which the scroller brings near the top as it arrives. */
  scrollAnchor?: boolean;
  /** The turn the row is part of, drawn as a box with its other rows when far from view. */
  turnId?: string;
}) {
  const owner = useScrollOwner();
  const farRows = useFarRows();
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const attach = React.useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      assignRef(ref, element);
    },
    [ref],
  );
  React.useLayoutEffect(() => {
    const element = elementRef.current;
    owner.registerItem(messageId, element);
    return () => {
      owner.registerItem(messageId, null);
      if (element) {
        owner.unregisterElement(element);
      }
    };
  }, [owner, messageId]);
  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (turnId === undefined || !element) {
      return;
    }
    return () => {
      farRows.unregister(element);
    };
  }, [farRows, turnId]);
  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (turnId !== undefined && element) {
      farRows.register(turnId, element, keepDrawn);
    }
  }, [farRows, keepDrawn, turnId]);
  // How tall its box is while it is far from view, or none while it is drawn.
  const boxHeight = React.useSyncExternalStore(
    (listener) =>
      turnId === undefined ? noop : farRows.subscribe(turnId, listener),
    () => {
      const element = elementRef.current;
      return turnId !== undefined && element && farRows.isBoxed(turnId)
        ? farRows.boxHeightOf(element)
        : undefined;
    },
  );
  const isBox = boxHeight !== undefined;
  return (
    <div
      // The column is a log, which reads out what is added to it. A turn
      // drawn again as the reader comes back to it, or a page of older ones,
      // is not news; what arrives in the turns kept drawn is.
      aria-live={turnId !== undefined && !keepDrawn ? "off" : undefined}
      className={cn("min-w-0 shrink-0", className)}
      data-message-id={messageId}
      data-message-scroller-item=""
      data-placeholder={isBox ? "" : undefined}
      data-scroll-anchor={scrollAnchor ? "true" : "false"}
      data-slot="message-scroller-item"
      data-turn-id={turnId}
      ref={attach}
      style={style}
      {...props}
    >
      {isBox ? <div style={{ height: boxHeight }} /> : children}
    </div>
  );
}

function noop() {
  // Nothing to stop listening to.
}

// The transcript is not a tab stop and never draws a focus ring. It is a
// reading surface, and a stop that shows nothing on arrival is worse than no
// stop at all. Clicking still focuses it, so the arrow keys scroll it as soon
// as a reader is in it; the ring that would otherwise follow that click is
// what `outline-none` drops.
//
// Both axes are declared, because leaving one out does not mean what it reads
// like: an axis left `visible` beside an `auto` one computes to `auto` itself.
// A transcript is a column, and anything in it that is genuinely wider than the
// column -- a table, a code block -- carries its own horizontal scroller, so
// the pane has nothing to offer sideways. Left implicit, a stray pixel of
// overflow buys a horizontal scrollbar across the foot of the conversation,
// which is invisible where scrollbars are overlays and a permanent grey band
// where they are not.
//
// The scrollbar's room is kept whether or not it shows. Where scrollbars take
// room (Windows, Linux), a first message's rows end exactly at the pane's foot,
// so a growing reply overflows until the scroll owner trims its spacer: the bar
// would come and go and rewrap the rows inside the owner's resize callback.
//
// `isolate` keeps what a message raises (a file card's `z-10` text) under the
// scroller's own overlays, the jump-to-end button and the fades, which follow
// the viewport in the tree without a z-index of their own.
function MessageScrollerViewport({
  className,
  ref,
  tabIndex = -1,
  ...props
}: React.ComponentProps<"div">) {
  const owner = useScrollOwner();
  const farRows = useFarRows();
  const attachToOwner = useAttach(owner.setViewport, ref);
  const attach = React.useCallback(
    (element: HTMLDivElement | null) => {
      attachToOwner(element);
      farRows.setViewport(element);
    },
    [attachToOwner, farRows],
  );
  return (
    <div
      aria-label="Messages"
      className={cn(
        "isolate size-full min-h-0 min-w-0 scrollbar-thin scrollbar-color overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] outline-none",
        className,
      )}
      data-slot="message-scroller-viewport"
      ref={attach}
      role="region"
      tabIndex={tabIndex}
      {...props}
    />
  );
}

/**
 * A ref callback that keeps its identity while what it hands the element to
 * does, so the scroller is not detached and attached again on every render.
 */
function useAttach<T>(
  attach: (element: T | null) => void,
  ref?: React.Ref<T>,
): React.RefCallback<T> {
  return React.useCallback(
    (element: T | null) => {
      attach(element);
      assignRef(ref, element);
    },
    [attach, ref],
  );
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export {
  MessageScroller,
  useFarRows,
  useMessageScroller,
  ScrollPin,
  useMessageScrollerScrollable,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
};
