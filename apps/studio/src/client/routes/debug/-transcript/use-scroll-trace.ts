import { type RefObject, useEffect, useRef, useState } from "react";

/** Something on screen that moved when nothing the reader did moved it. */
export interface TraceEvent {
  /** The replay frame on screen when it happened. */
  frame: number;
  /**
   * - `moved`: what the reader was looking at shifted while held or kept.
   * - `jumped`: the column moved down while following, which following never does.
   * - `behind`: the end slipped out of view for more than a frame while followed.
   */
  kind: "behind" | "jumped" | "moved";
  mode: string;
  /** How far, in px. */
  px: number;
  /** What else stood out that frame: the spacer, and how much the column grew. */
  detail?: string;
}

/** How long after the reader's own input a move is theirs. */
const INPUT_MS = 400;
const MAX_EVENTS = 40;

/**
 * Watches the transcript and records each move the scroller is not meant to
 * make: the held message or the reader's place shifting, the column going
 * backward while following, or the end falling out of view. A clean run
 * records nothing, which is the whole check.
 *
 * The end slipping is noted when the column resizes and counted only if it is
 * still out of view at the next frame with nothing grown since, so it is what
 * was painted: read any earlier and every growth looks like a miss, since the
 * scroller writes the position in a resize callback of its own.
 */
export function useScrollTrace({
  active,
  autoScroll,
  frameIndex,
  frameRef,
}: {
  active: boolean;
  autoScroll: boolean;
  frameIndex: number;
  frameRef: RefObject<HTMLElement | null>;
}): { clear: () => void; events: TraceEvent[] } {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const frameIndexRef = useRef(frameIndex);
  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  useEffect(() => {
    const viewport = frameRef.current?.querySelector<HTMLElement>(
      "[data-slot=message-scroller-viewport]",
    );
    if (!active || !viewport) {
      return;
    }
    let lastInput = Number.NEGATIVE_INFINITY;
    const onInput = () => {
      lastInput = performance.now();
    };
    const inputs = ["wheel", "pointerdown", "keydown", "touchmove"] as const;
    for (const type of inputs) {
      viewport.addEventListener(type, onInput, { passive: true });
    }
    let reference: { element: Element; top: number } | undefined;
    let lastHeight = viewport.scrollHeight;
    let behind: { detail: string; height: number } | undefined;
    let frame = 0;
    const record = (event: Omit<TraceEvent, "frame">) => {
      setEvents((current) =>
        [{ ...event, frame: frameIndexRef.current }, ...current].slice(
          0,
          MAX_EVENTS,
        ),
      );
    };
    const check = (afterResize: boolean) => {
      const mode = viewport.dataset.scrollMode ?? "";
      const sliding = viewport
        .closest("[data-slot=message-scroller]")
        ?.hasAttribute("data-sliding");
      if (performance.now() - lastInput < INPUT_MS || sliding) {
        reference = undefined;
        return;
      }
      const viewportTop = viewport.getBoundingClientRect().top;
      const items = [
        ...viewport.querySelectorAll("[data-message-scroller-item]"),
      ];
      const anchor =
        mode === "anchor"
          ? items
              .filter((item) => item.matches("[data-scroll-anchor=true]"))
              .at(-1)
          : undefined;
      const element =
        anchor ??
        items.find((item) => item.getBoundingClientRect().bottom > viewportTop);
      if (element) {
        const top = element.getBoundingClientRect().top - viewportTop;
        if (reference?.element === element) {
          const delta = Math.round(top - reference.top);
          if (mode === "follow" ? delta > 1 : Math.abs(delta) > 1) {
            record({
              kind: mode === "follow" ? "jumped" : "moved",
              mode,
              px: delta,
            });
          }
        }
        reference = { element, top };
      }
      const gap = Math.round(
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      );
      const height = viewport.scrollHeight;
      const grew = height - lastHeight;
      lastHeight = height;
      // Only a resize check runs after the scroller's own write: a scroll event
      // and a frame callback both come before it in a frame, after growth a
      // commit between frames made and before the scroller has followed it.
      if (afterResize && mode === "follow" && autoScroll && gap > 1) {
        const spacer =
          viewport.querySelector<HTMLElement>("[data-message-scroller-spacer]")
            ?.offsetHeight ?? 0;
        behind = {
          detail: `spacer ${spacer.toString()}, grew ${grew.toString()}`,
          height,
        };
      }
    };
    const confirm = () => {
      frame = requestAnimationFrame(confirm);
      const pending = behind;
      behind = undefined;
      if (!pending || viewport.scrollHeight !== pending.height) {
        return;
      }
      const gap = Math.round(
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      );
      const mode = viewport.dataset.scrollMode ?? "";
      if (mode === "follow" && gap > 1) {
        record({ detail: pending.detail, kind: "behind", mode, px: gap });
      }
    };
    frame = requestAnimationFrame(confirm);
    const content = viewport.querySelector(
      "[data-slot=message-scroller-content]",
    );
    const resizes = new ResizeObserver(() => {
      check(true);
    });
    const onScroll = () => {
      check(false);
    };
    resizes.observe(viewport);
    if (content) {
      resizes.observe(content);
    }
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resizes.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      for (const type of inputs) {
        viewport.removeEventListener(type, onInput);
      }
    };
  }, [active, autoScroll, frameRef]);

  return {
    clear: () => {
      setEvents([]);
    },
    events,
  };
}
