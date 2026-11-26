import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { commandKeyHeld } from "@/client/lib/utils";

import { useMessageScroller } from "../ui/message-scroller";

/** A row the keyboard stops on: a message the person sent, or a reply. */
const STOP = "[data-message-stop]";

/** Room kept between a ringed message and the edge of the pane, in pixels. */
const EDGE_ROOM = 24;

/** How far the ring stands off what it goes around, in pixels. */
const RING_OFFSET = 8;

export interface MessageKeysHandle {
  /** Rings the last message, for Up from the empty box. False when there is none. */
  enterFromBox: () => boolean;
}

/** Where the ring is drawn, in the transcript's own coordinates. */
interface RingBox {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * The arrow keys through a chat's messages. Up from the empty box rings the
 * last message; Up and Down step between the messages the person sent and
 * whole replies, a reply's work and cards included; Down from the last and
 * Escape from any go back to the box. Command-C with nothing selected copies
 * the ringed message, as its Copy button does. A letter typed on one goes to
 * the box (`type-to-compose.ts`).
 *
 * The ring comes only from these keys: a click puts the keyboard in the
 * transcript to scroll it, as before, and rings nothing. A reply that runs
 * on from the turn above it (`continues`) is one stop with it, under one
 * ring drawn around all its rows.
 *
 * It has to sit inside the chat's `MessageScrollerProvider`, and its
 * transcript (`contentRef`) has to be positioned, for the ring to sit in it.
 */
export function MessageKeys({
  contentRef,
  onLeave,
  ref,
}: {
  contentRef: React.RefObject<HTMLElement | null>;
  /** Puts the keyboard back in the box. */
  onLeave: () => void;
  ref: React.Ref<MessageKeysHandle>;
}) {
  const { releaseAutoScroll } = useMessageScroller();
  const ringed = useRef<{ release: () => void; stop: HTMLElement[] } | null>(
    null,
  );
  const [content, setContent] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<RingBox | null>(null);

  const clear = () => {
    ringed.current?.release();
    ringed.current = null;
    setBox(null);
  };

  const ring = (stop: HTMLElement[]) => {
    const head = stop[0];
    const within = contentRef.current;
    if (!head || !within) {
      return;
    }
    clear();
    releaseAutoScroll();
    const measure = () => {
      setBox(ringBoxOf(stop, within));
    };
    // A reply still arriving grows under its ring.
    const observer = new ResizeObserver(measure);
    for (const element of stop) {
      observer.observe(element);
    }
    const onBlur = () => {
      if (ringed.current?.stop === stop) {
        clear();
      }
    };
    head.tabIndex = -1;
    head.setAttribute("data-ringed", "");
    head.addEventListener("blur", onBlur);
    ringed.current = {
      release: () => {
        observer.disconnect();
        head.removeEventListener("blur", onBlur);
        head.removeAttribute("data-ringed");
        head.removeAttribute("tabindex");
      },
      stop,
    };
    head.focus({ preventScroll: true });
    bringIntoView(stop);
    measure();
  };

  useImperativeHandle(ref, () => ({
    enterFromBox: () => {
      const within = contentRef.current;
      const last = within ? stopsIn(within).at(-1) : undefined;
      if (!last) {
        return false;
      }
      ring(last);
      return true;
    },
  }));

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const stop = ringed.current?.stop;
    const within = contentRef.current;
    if (!stop || !within || event.target !== stop[0] || event.isComposing) {
      return;
    }
    const plain =
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (plain && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const stops = stopsIn(within);
      const at = stops.findIndex((each) => each[0] === stop[0]);
      const next = stops[at + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) {
        ring(next);
      } else if (event.key === "ArrowDown") {
        onLeave();
      } else {
        bringIntoView(stop);
      }
      return;
    }
    // Ahead of the window's Escape, which stops a running chat: from a
    // ringed message the first press goes back to the box.
    if (plain && event.key === "Escape") {
      event.preventDefault();
      onLeave();
      return;
    }
    if (
      commandKeyHeld(event) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "c" &&
      (window.getSelection()?.isCollapsed ?? true)
    ) {
      const copy = stop
        .flatMap((element) => [
          ...element.querySelectorAll<HTMLElement>("[data-copy-message]"),
        ])
        .at(-1);
      if (copy) {
        event.preventDefault();
        copy.click();
      }
    }
  });

  const onUnmount = useEffectEvent(() => {
    clear();
  });

  useEffect(() => {
    const within = contentRef.current;
    setContent(within);
    if (!within) {
      return;
    }
    const listener = (event: KeyboardEvent) => {
      onKeyDown(event);
    };
    within.addEventListener("keydown", listener);
    return () => {
      within.removeEventListener("keydown", listener);
      onUnmount();
    };
  }, [contentRef]);

  return content && box
    ? createPortal(
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-2xl outline-[3px] outline-ring/50 [outline-style:solid]"
          data-message-ring=""
          style={box}
        />,
        content,
      )
    : null;
}

/** The stops in the transcript, top to bottom, each its rows. */
function stopsIn(content: Element): HTMLElement[][] {
  const stops: HTMLElement[][] = [];
  for (const element of content.querySelectorAll<HTMLElement>(STOP)) {
    const last = stops.at(-1);
    if (element.dataset.messageStop === "continues" && last) {
      last.push(element);
    } else {
      stops.push([element]);
    }
  }
  return stops;
}

/** The box around every row of a stop, set off from them, where `content` draws it. */
function ringBoxOf(stop: HTMLElement[], content: HTMLElement): RingBox {
  const origin = content.getBoundingClientRect();
  const rects = stop.map((element) => element.getBoundingClientRect());
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  return {
    height: bottom - top + RING_OFFSET * 2,
    left: left - origin.left - RING_OFFSET,
    top: top - origin.top - RING_OFFSET,
    width: right - left + RING_OFFSET * 2,
  };
}

/**
 * Scrolls the pane the least that shows the whole stop, or its top when it is
 * taller than the pane, so a long reply is read from its start.
 */
function bringIntoView(stop: HTMLElement[]) {
  const first = stop[0];
  const last = stop.at(-1);
  const viewport = first?.closest<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );
  if (!first || !last || !viewport) {
    return;
  }
  const pane = viewport.getBoundingClientRect();
  const top = first.getBoundingClientRect().top - EDGE_ROOM;
  const bottom = last.getBoundingClientRect().bottom + EDGE_ROOM;
  if (bottom - top > pane.height || top < pane.top) {
    viewport.scrollBy({ top: top - pane.top });
  } else if (bottom > pane.bottom) {
    viewport.scrollBy({ top: bottom - pane.bottom });
  }
}
