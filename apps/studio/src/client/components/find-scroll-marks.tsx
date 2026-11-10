import { cn } from "@/client/lib/utils";
import { type RefObject, useLayoutEffect, useState } from "react";

/** A match's place down what scrolls, from 0 at its top to 1 at its end. */
export type FindMark = { at: number; isActive: boolean };

/**
 * A find's matches as ticks down the right edge of what scrolls, over the
 * scrollbar, as a browser marks a page's: where the matches are in the whole
 * document rather than in the view. Placed by its parent over the scrolling
 * box; the ticks take no pointer, so the scrollbar under them still drags.
 */
export function FindScrollMarks({
  className,
  marks,
}: {
  className?: string;
  marks: readonly FindMark[];
}) {
  if (marks.length === 0) {
    return null;
  }
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 z-10 w-2.5",
        className,
      )}
    >
      {marks.map((mark) => (
        <span
          className={cn(
            "absolute right-0.5 h-0.5 w-2 -translate-y-1/2 rounded-full",
            mark.isActive ? "bg-yellow-500" : "bg-yellow-500/60",
          )}
          key={`${mark.at.toString()}:${mark.isActive ? "active" : ""}`}
          style={{ top: `${mark.at * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Where `ranges` are down `viewport`'s scroll, for {@link FindScrollMarks}:
 * read again as the ranges change and as the viewport or what it scrolls
 * changes size. Matches closer than a tick's height share one, the active
 * one's if it is among them.
 */
export function useRangeMarks(
  viewportRef: RefObject<HTMLElement | null>,
  ranges: readonly Range[],
  active: number,
): FindMark[] {
  const [marks, setMarks] = useState<FindMark[]>([]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || ranges.length === 0) {
      setMarks([]);
      return;
    }
    const read = () => {
      setMarks(rangeMarks(viewport, ranges, active));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(viewport);
    for (const child of viewport.children) {
      observer.observe(child);
    }
    return () => {
      observer.disconnect();
    };
  }, [active, ranges, viewportRef]);
  return marks;
}

function rangeMarks(
  viewport: HTMLElement,
  ranges: readonly Range[],
  active: number,
): FindMark[] {
  const view = viewport.getBoundingClientRect();
  const height = viewport.scrollHeight;
  if (height === 0 || viewport.offsetHeight === 0) {
    return [];
  }
  // Rects are on-screen px and scroll lengths layout px under the app's zoom.
  const scale = view.height / viewport.offsetHeight;
  return dedupe(
    ranges.flatMap((range, index) => {
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return [];
      }
      const top =
        (rect.top + rect.height / 2 - view.top) / scale + viewport.scrollTop;
      return [{ at: clampUnit(top / height), isActive: index === active }];
    }),
    viewport.clientHeight,
  );
}

/**
 * Marks for a strip `stripHeight` px tall, one per 2px band, so a few hundred
 * matches draw as a few hundred ticks at most.
 */
export function dedupe(
  marks: readonly FindMark[],
  stripHeight: number,
): FindMark[] {
  const bands = new Map<number, FindMark>();
  for (const mark of marks) {
    const band = Math.round((mark.at * stripHeight) / 2);
    if (!bands.get(band)?.isActive) {
      bands.set(band, mark);
    }
  }
  return [...bands.values()];
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}
