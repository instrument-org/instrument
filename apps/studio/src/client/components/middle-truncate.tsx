import {
  ELLIPSIS,
  fitMiddle,
  fitTwoLines,
  fontOf,
  forgetTextWidths,
  textWidth,
  type TextFont,
} from "@/client/lib/middle-truncate";
import { cn } from "@/client/lib/utils";
import {
  type ReactNode,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** What each measured box does when its width changes. */
const onResize = new WeakMap<Element, () => void>();
let observer: ResizeObserver | undefined;

/** One observer for every box, since a list can show hundreds of names. */
function observe(element: Element, run: () => void) {
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      onResize.get(entry.target)?.();
    }
  });
  onResize.set(element, run);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    onResize.delete(element);
  };
}

/** Every box to measure again once a font has loaded. */
const refits = new Set<() => void>();
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.addEventListener("loadingdone", () => {
    forgetTextWidths();
    for (const refit of refits) {
      refit();
    }
  });
}

/**
 * What the page said of the whole text: its width when it overflowed its
 * line, the width it fit in when it did not, and the canvas's measures
 * scaled to the page.
 */
type Measured = { fitsAt?: number; natural?: number; scale: number };

/**
 * Fits `text` to the width its box is given, keeping `fit` up to date as the
 * box resizes, its font finishes loading, or the text changes.
 */
function useFit(
  text: string,
  fit: (width: number, font: TextFont) => string[],
) {
  const box = useRef<HTMLSpanElement>(null);
  // The lines shown, with the text they were fitted for.
  const [fitted, setFitted] = useState({ lines: [text], text });
  const refit = useEffectEvent(
    (element: HTMLElement, font: TextFont, measured: Measured) => {
      const width = element.clientWidth;
      const fits =
        measured.natural === undefined
          ? measured.fitsAt !== undefined && width >= measured.fitsAt
          : measured.natural <= width + 0.5;
      // A pixel under the box, so a rounding difference between the canvas
      // and the page never clips the last letter.
      const lines = fits ? [text] : fit((width - 1) / measured.scale, font);
      setFitted((previous) =>
        previous.text === text && previous.lines.join("\n") === lines.join("\n")
          ? previous
          : { lines, text },
      );
    },
  );
  useLayoutEffect(() => {
    const element = box.current;
    const line = element?.querySelector<HTMLElement>("[data-fit-line]");
    if (!element || !line) {
      return;
    }
    const font = fontOf(element);
    // The whole text is showing now, so the page's own width for it says
    // how far the canvas is off, which a font's alternate letters can make
    // it: what the canvas measures is scaled to the page.
    const overflows = line.scrollWidth > line.clientWidth;
    let measured: Measured = overflows
      ? {
          natural: line.scrollWidth,
          scale: line.scrollWidth / (textWidth(text, font) || 1),
        }
      : { fitsAt: line.clientWidth, scale: 1 };
    const run = () => {
      refit(element, font, measured);
    };
    const afterFonts = () => {
      measured = { scale: 1 };
      run();
    };
    run();
    refits.add(afterFonts);
    const stop = observe(element, run);
    return () => {
      refits.delete(afterFonts);
      stop();
    };
  }, [text]);
  return { box, lines: fitted.text === text ? fitted.lines : [text] };
}

/**
 * The whole text, drawn out of sight from the box's `data-text`, sizes the
 * box, so what is shown in it never decides how wide it is. Being a pseudo
 * element, it adds nothing to the box's text.
 */
const SIZED_BY_WHOLE_TEXT =
  "grid min-w-0 grid-cols-[minmax(0,auto)] before:invisible before:col-start-1 before:row-start-1 before:h-0 before:min-w-0 before:overflow-hidden before:whitespace-pre before:content-[attr(data-text)]";

/**
 * A name on one line, cut in its middle to fit its box, the way the Finder
 * shows a long file name: `Quarterly rep…2026.pdf`. `extension` keeps a
 * file's extension whole after the cut.
 *
 * The box takes the width the whole name would, up to what its parent
 * gives it, so it sits in a row the way a `truncate` span does.
 */
export function MiddleTruncate({
  className,
  extension = false,
  renderText = (piece) => piece,
  text,
}: {
  className?: string;
  extension?: boolean;
  /** Draws a piece of the text, given where it starts in the whole, for marks such as a search's matches. */
  renderText?: (piece: string, start: number) => ReactNode;
  text: string;
}) {
  const { box, lines } = useFit(text, (width, font) => [
    fitMiddle(text, width, font, { extension }),
  ]);
  const shown = lines[0] ?? text;
  // Where the cut is: the letters kept from the start, and from the end.
  let head = 0;
  while (head < shown.length && shown[head] === text[head]) {
    head += 1;
  }
  const tail = Math.max(0, shown.length - head - ELLIPSIS.length);
  return (
    <span
      className={cn(SIZED_BY_WHOLE_TEXT, className)}
      data-text={text}
      ref={box}
    >
      {shown === text ? (
        <span
          className="col-start-1 row-start-1 overflow-hidden whitespace-pre"
          data-fit-line=""
        >
          {renderText(text, 0)}
        </span>
      ) : (
        <>
          <span
            aria-hidden
            className="col-start-1 row-start-1 overflow-hidden whitespace-pre"
          >
            {renderText(text.slice(0, head), 0)}
            {ELLIPSIS}
            {tail > 0
              ? renderText(text.slice(-tail), text.length - tail)
              : null}
          </span>
          <span className="sr-only">{text}</span>
        </>
      )}
    </span>
  );
}

/**
 * A name on at most two lines, the way the Finder labels an icon: the first
 * line as full as it gets, and the rest cut in its middle on the second.
 */
export function TwoLineTruncate({
  className,
  extension = false,
  text,
}: {
  className?: string;
  extension?: boolean;
  text: string;
}) {
  const { box, lines } = useFit(text, (width, font) =>
    fitTwoLines(text, width, font, { extension }),
  );
  return (
    <span
      className={cn(SIZED_BY_WHOLE_TEXT, className)}
      data-text={text}
      ref={box}
    >
      <span className="col-start-1 row-start-1 min-w-0">
        {lines.length === 1 ? (
          <span
            className="block overflow-hidden whitespace-pre"
            data-fit-line=""
          >
            {lines[0]}
          </span>
        ) : (
          <>
            <span aria-hidden className="block overflow-hidden whitespace-pre">
              {lines[0]}
            </span>
            <span aria-hidden className="block overflow-hidden whitespace-pre">
              {lines[1]}
            </span>
            <span className="sr-only">{text}</span>
          </>
        )}
      </span>
    </span>
  );
}
