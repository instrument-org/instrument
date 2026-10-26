import { cn } from "@/client/lib/utils";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * A trail of names on one line, a path or the parts of a place, that gives
 * way in the middle when it runs out of room.
 *
 * The folders after the first fold into one mark (`fold`) first, the way a
 * folder window's path bar gives them up, so the first part, the one before
 * the last and the last keep their whole names for as long as the box holds
 * them. Past that the end stays in view and the head scrolls off to the left:
 * the place itself is the part that has to be readable. How many fold is
 * measured off a copy of the trail at its natural width, drawn out of sight,
 * so `labelClassName` and `foldMark` are what a part's padding and the
 * fold's mark look like for that measure, and `reserve` is room the parts
 * take beyond their names (a mark before the first). `keepBeforeLast` off
 * lets the one before the last fold too, for a trail where only where it
 * starts and what it names matter.
 */
export function FoldingTrail({
  className,
  fold,
  foldMark,
  keepBeforeLast = true,
  labelClassName,
  labels,
  part,
  reserve = 0,
  separator,
}: {
  className?: string;
  /** The mark standing in for the folded parts, given their indexes. */
  fold: (indexes: number[]) => ReactNode;
  /** The fold's mark alone, measured for the room it takes. */
  foldMark: ReactNode;
  keepBeforeLast?: boolean;
  /** Each part's padding, measured with its name. */
  labelClassName?: string;
  labels: string[];
  /** The part at an index, keyed, with the separator before it when it is not the first. */
  part: (index: number) => ReactNode;
  /** Pixels the parts take beyond their measured names. */
  reserve?: number;
  separator: ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const natural = useRef<HTMLSpanElement>(null);
  const trail = labels.join("/");
  useEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const showLast = () => {
      const last = element.lastElementChild;
      if (last instanceof HTMLElement) {
        element.scrollLeft = Math.min(
          last.offsetLeft,
          element.scrollWidth - element.clientWidth,
        );
      }
    };
    showLast();
    // Again whenever the box changes size, which is the pane being dragged
    // narrower: the trail that fit a moment ago has to give up its head.
    const observer = new ResizeObserver(showLast);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [trail]);
  const [folded, setFolded] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    const copy = natural.current;
    if (!element || !copy) {
      return;
    }
    const fit = () => {
      const widthOf = (selector: string) =>
        [...copy.querySelectorAll<HTMLElement>(selector)].map(
          (one) => one.offsetWidth,
        );
      const widths = widthOf("[data-crumb]");
      const separatorWidth = widthOf("[data-separator]")[0] ?? 0;
      const more = widthOf("[data-more]")[0] ?? 0;
      const foldable = Math.max(0, widths.length - (keepBeforeLast ? 3 : 2));
      const widthWith = (count: number) =>
        widths.reduce(
          (sum, width, index) =>
            index >= 1 && index <= count ? sum : sum + width,
          0,
        ) +
        separatorWidth * (widths.length - count - 1) +
        (count > 0 ? separatorWidth + more : 0) +
        reserve;
      let count = 0;
      while (count < foldable && widthWith(count) > element.clientWidth + 1) {
        count += 1;
      }
      setFolded(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [keepBeforeLast, reserve, trail]);
  const hidden = labels.slice(1, 1 + folded).map((_, index) => index + 1);
  return (
    <span
      className={cn(
        "relative scrollbar-hide flex min-w-0 items-center overflow-x-auto",
        className,
      )}
      ref={box}
    >
      {labels.length > 0 ? part(0) : null}
      {hidden.length > 0 ? (
        <>
          {separator}
          {fold(hidden)}
        </>
      ) : null}
      {labels.slice(1 + folded).map((_, index) => part(index + 1 + folded))}
      {/* The whole trail at its natural width, out of sight, for the parts
          that fold to be measured against. */}
      <span
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center"
        ref={natural}
      >
        {labels.map((label, index) => (
          <span
            className={labelClassName}
            data-crumb=""
            key={`${String(index)}:${label}`}
          >
            {label}
          </span>
        ))}
        <span data-separator="">{separator}</span>
        <span data-more="">{foldMark}</span>
      </span>
    </span>
  );
}
