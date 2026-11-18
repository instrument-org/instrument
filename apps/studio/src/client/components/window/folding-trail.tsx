import {
  cssZoomOf,
  fitMiddle,
  fontOf,
  layoutWidth,
  type TextFont,
} from "@/client/lib/middle-truncate";
import { cn } from "@/client/lib/utils";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** What the page measured of one part at its natural size. */
type PartSize = {
  /** The gap between its mark and its name. */
  gap: number;
  /** The part with its mark alone. */
  markOnly: number;
  /** Its name. */
  name: number;
};

/** How a part is shown: its name at a width, whole, or folded to its mark. */
type PartFit =
  | { kind: "folded" }
  | { kind: "whole" }
  | { kind: "cut"; width: number };

/**
 * The widths the names get when `free` pixels are shared between them: the
 * longest give up letters first, each down to its floor, and `undefined`
 * when the floors alone take more than `free`.
 */
function shareWidths(
  names: number[],
  floors: number[],
  free: number,
): number[] | undefined {
  const sum = (widths: number[]) =>
    widths.reduce((total, one) => total + one, 0);
  if (sum(names) <= free) {
    return names;
  }
  const at = (cap: number) =>
    names.map((name, index) =>
      Math.min(name, Math.max(cap, floors[index] ?? 0)),
    );
  if (sum(at(0)) > free) {
    return undefined;
  }
  let low = 0;
  let high = Math.max(...names);
  for (let step = 0; step < 24; step += 1) {
    const cap = (low + high) / 2;
    if (sum(at(cap)) <= free) {
      low = cap;
    } else {
      high = cap;
    }
  }
  return at(low);
}

/**
 * The order parts fold to their marks in, the way the Finder's path bar
 * gives them up: every folder between the first and the one before the last
 * at once, then the first, then the one before the last. The last never
 * folds; its name is cut in its middle once everything else is a mark.
 */
function foldStages(count: number) {
  const middle = Array.from(
    { length: Math.max(0, count - 3) },
    (_, index) => index + 1,
  );
  const stages: number[][] = [[]];
  if (middle.length > 0) {
    stages.push(middle);
  }
  if (count >= 3) {
    stages.push([...middle, 0]);
  }
  if (count >= 2) {
    stages.push(Array.from({ length: count - 1 }, (_, index) => index));
  }
  return stages;
}

/**
 * How each part is shown in `width` pixels: names shortened first, longest
 * first, then folded to their marks stage by stage, then the last name cut.
 * A part with no mark never folds.
 */
export function fitTrail(
  sizes: PartSize[],
  {
    floor,
    hasMark,
    reserve,
    separator,
    width,
  }: {
    /** The narrowest a name is cut to before its part folds. */
    floor: number;
    hasMark: boolean[];
    reserve: number;
    separator: number;
    width: number;
  },
): PartFit[] {
  const count = sizes.length;
  const last = count - 1;
  const room = width - reserve - separator * Math.max(0, count - 1);
  for (const stage of foldStages(count)) {
    const folded = new Set(stage.filter((index) => hasMark[index]));
    const fixed = sizes.reduce(
      (total, size, index) =>
        total + size.markOnly + (folded.has(index) ? 0 : size.gap),
      0,
    );
    const lastName = sizes[last]?.name ?? 0;
    const shrinking = sizes
      .map((size, index) => ({ index, size }))
      .filter(({ index }) => index !== last && !folded.has(index));
    const shared = shareWidths(
      shrinking.map(({ size }) => size.name),
      shrinking.map(({ size }) => Math.min(size.name, floor)),
      room - fixed - lastName,
    );
    if (shared) {
      const fits: PartFit[] = sizes.map((_, index) =>
        folded.has(index) ? { kind: "folded" } : { kind: "whole" },
      );
      shrinking.forEach(({ index, size }, at) => {
        const given = shared[at] ?? size.name;
        if (given < size.name) {
          fits[index] = { kind: "cut", width: given };
        }
      });
      return fits;
    }
  }
  // Everything that folds has folded: the last name takes what is left.
  const folded = new Set(
    foldStages(count)
      .at(-1)
      ?.filter((index) => hasMark[index]),
  );
  const others = sizes.reduce(
    (total, size, index) =>
      index === last
        ? total
        : total +
          size.markOnly +
          (folded.has(index) ? 0 : size.gap + Math.min(size.name, floor)),
    0,
  );
  const lastSize = sizes[last];
  return sizes.map((size, index) => {
    if (index === last && lastSize) {
      const given = Math.max(
        Math.min(lastSize.name, floor),
        room - others - lastSize.markOnly - lastSize.gap,
      );
      return given < lastSize.name
        ? { kind: "cut", width: given }
        : { kind: "whole" };
    }
    if (folded.has(index)) {
      return { kind: "folded" };
    }
    return size.name > floor
      ? { kind: "cut", width: floor }
      : { kind: "whole" };
  });
}

/** The width a part's name is shown at. */
function shownWidth(fit: PartFit, size: PartSize) {
  if (fit.kind === "whole") {
    return size.name;
  }
  return fit.kind === "cut" ? fit.width : 0;
}

/**
 * How each part is shown while the one at `pointed` shows its whole name:
 * the last name gives up the room it grows by, down to the floor, so the
 * trail's end stays in its box. The parts before it keep their widths, so
 * nothing moves under the pointer.
 */
function fitPointed(
  fits: PartFit[],
  sizes: PartSize[],
  pointed: number,
  {
    floor,
    reserve,
    separator,
    width,
  }: { floor: number; reserve: number; separator: number; width: number },
): PartFit[] {
  const last = sizes.length - 1;
  const lastSize = sizes[last];
  const lastFit = fits[last];
  const pointedSize = sizes[pointed];
  const pointedFit = fits[pointed];
  if (
    pointed === last ||
    !lastSize ||
    !lastFit ||
    !pointedSize ||
    !pointedFit
  ) {
    return fits;
  }
  const shown = (fit: PartFit, size: PartSize) =>
    size.markOnly +
    (fit.kind === "folded" ? 0 : size.gap + shownWidth(fit, size));
  const used = sizes.reduce(
    (total, size, index) =>
      total + shown(fits[index] ?? { kind: "whole" }, size),
    reserve + separator * last,
  );
  const grows =
    pointedSize.markOnly +
    pointedSize.gap +
    pointedSize.name -
    shown(pointedFit, pointedSize);
  const lastWidth = shownWidth(lastFit, lastSize);
  const given = Math.max(
    Math.min(lastSize.name, floor),
    lastWidth - (used + grows - width),
  );
  return given < lastWidth
    ? fits.map((fit, index) =>
        index === last ? { kind: "cut", width: given } : fit,
      )
    : fits;
}

/**
 * A trail of names on one line, a path or the parts of a place, that gives
 * way the way a folder window's path bar does as its box narrows: the names
 * shorten first, cut in their middles, longest first; then every folder
 * between the first and the one before the last folds to its mark at once,
 * then the first, then the one before the last, so the marks still count the
 * folders; and last of all the last name is cut. Pointing at a part shows its
 * whole name in place, growing out of its mark or its cut, and the last name
 * gives up the room it takes.
 *
 * Each part is its mark (`mark`, which may be none, and then it never folds)
 * and its name, wrapped by `part` in whatever it is pressed as, with the
 * separator before it when it is not the first. The parts are measured off a
 * copy drawn out of sight, so `labelClassName` is a part's padding for that
 * measure, and `reserve` is room the trail takes beyond its parts.
 */
export function FoldingTrail({
  className,
  cutsAtEnd,
  labelClassName,
  labels,
  mark,
  onShortChange,
  part,
  reserve = 0,
  separator,
}: {
  className?: string;
  /** Whether a part's name, once cut, ends in an ellipsis rather than losing its middle: a title, which reads from its start. */
  cutsAtEnd?: (index: number) => boolean;
  /** Each part's padding, measured with its mark and name. */
  labelClassName?: string;
  labels: string[];
  /** The mark a part shows before its name, and folds to. */
  mark: (index: number) => ReactNode;
  /** Told whether any part is cut or folded, each time that changes. */
  onShortChange?: (isShort: boolean) => void;
  /** The part at an index, keyed, given its mark and name, with the separator before it when it is not the first. */
  part: (index: number, content: ReactNode) => ReactNode;
  /** Pixels the trail takes beyond its parts. */
  reserve?: number;
  separator: ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const natural = useRef<HTMLSpanElement>(null);
  const trail = labels.join("/");
  const [fits, setFits] = useState<{
    font?: TextFont;
    /** What `fitPointed` needs to make room for a pointed part. */
    measured?: {
      floor: number;
      separator: number;
      sizes: PartSize[];
      width: number;
    };
    parts: PartFit[];
    total?: number;
    trail: string;
  }>({
    parts: [],
    trail,
  });
  const [pointedAt, setPointedAt] = useState<number | null>(null);
  // The part whose growing or shrinking animates; a box being resized
  // follows the pointer at once.
  const [moving, setMoving] = useState<number[]>([]);
  useLayoutEffect(() => {
    const element = box.current;
    const copy = natural.current;
    if (!element || !copy) {
      return;
    }
    const font = fontOf(element);
    const fontSize =
      Number.parseFloat(getComputedStyle(element).fontSize) || 13;
    // Measured again on every fit: a part's mark can arrive after its name
    // does, which changes the copy's size and so fits the trail again.
    const fit = () => {
      const crumbs = [...copy.querySelectorAll<HTMLElement>("[data-crumb]")];
      const sizes = crumbs.map((crumb): PartSize => {
        const markOf = crumb.querySelector<HTMLElement>("[data-crumb-mark]");
        const name = crumb.querySelector<HTMLElement>("[data-crumb-name]");
        const nameWidth = name ? layoutWidth(name) : 0;
        const gap =
          markOf && name
            ? (name.getBoundingClientRect().left -
                markOf.getBoundingClientRect().right) /
              cssZoomOf(name)
            : 0;
        return {
          gap,
          markOnly: layoutWidth(crumb) - nameWidth - gap,
          name: nameWidth,
        };
      });
      const hasMark = crumbs.map(
        (crumb) => crumb.querySelector("[data-crumb-mark]") !== null,
      );
      const separatorOf = copy.querySelector<HTMLElement>("[data-separator]");
      const separatorWidth = separatorOf ? layoutWidth(separatorOf) : 0;
      const measured = {
        // About four letters and the ellipsis: shorter than that, a cut
        // name says less than the folder's mark does.
        floor: fontSize * 4,
        separator: separatorWidth,
        sizes,
        width: layoutWidth(element),
      };
      setFits({
        font,
        measured,
        parts: fitTrail(sizes, { ...measured, hasMark, reserve }),
        // The copy draws one separator, and the trail one between each two
        // parts.
        total:
          layoutWidth(copy) + separatorWidth * (crumbs.length - 2) + reserve,
        trail,
      });
    };
    fit();
    const observer = new ResizeObserver(() => {
      setMoving([]);
      fit();
    });
    observer.observe(element);
    observer.observe(copy);
    return () => {
      observer.disconnect();
    };
  }, [reserve, trail]);
  const current = fits.trail === trail ? fits : undefined;
  // Past the point where even the marks fit, the head of the trail goes
  // off its start, so where you are stays in view. Not while a part is
  // pointed at: the trail moving would put another part under the pointer.
  useLayoutEffect(() => {
    const element = box.current;
    if (element && pointedAt === null) {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
    }
  }, [fits, pointedAt]);
  const isShort = (fits.trail === trail ? fits.parts : []).some(
    (fit) => fit.kind !== "whole",
  );
  const tellShort = useEffectEvent((short: boolean) => {
    onShortChange?.(short);
  });
  useEffect(() => {
    tellShort(isShort);
  }, [isShort]);
  const point = (index: number | null) => {
    setMoving(
      [pointedAt, index, labels.length - 1].filter(
        (one): one is number => one !== null,
      ),
    );
    setPointedAt(index);
  };
  const parts =
    current?.measured && pointedAt !== null
      ? fitPointed(current.parts, current.measured.sizes, pointedAt, {
          ...current.measured,
          reserve,
        })
      : current?.parts;
  return (
    <span
      className={cn(
        "relative flex min-w-0 items-center overflow-hidden [interpolate-size:allow-keywords]",
        className,
      )}
      onPointerLeave={() => {
        point(null);
      }}
      ref={box}
      // As wide as the whole trail when there is room for it, and never
      // wider than what it is given, so what it shows never sizes it.
      style={
        current?.total === undefined ? undefined : { flexBasis: current.total }
      }
    >
      {labels.map((label, index) => {
        const fit = parts?.[index] ?? { kind: "whole" };
        const isPointed = pointedAt === index;
        const isEndCut = fit.kind === "cut" && cutsAtEnd?.(index) === true;
        const shown =
          isPointed || fit.kind === "whole" || isEndCut
            ? label
            : fit.kind === "folded" || !current?.font
              ? ""
              : fitMiddle(label, fit.width - 0.5, current.font);
        const markOf = mark(index);
        const content = (
          <>
            {markOf}
            <span
              aria-hidden={shown === label ? undefined : true}
              className={cn(
                "overflow-hidden whitespace-pre",
                isEndCut && !isPointed && "text-ellipsis",
                markOf !== null && markOf !== undefined && "ml-1",
                !isPointed && fit.kind === "folded" && "ml-0",
                moving.includes(index) &&
                  "transition-[width,margin] duration-200 ease-out",
              )}
              style={
                isPointed || fit.kind === "whole"
                  ? { width: "auto" }
                  : { width: fit.kind === "folded" ? 0 : fit.width }
              }
            >
              {shown}
            </span>
            {shown === label ? null : <span className="sr-only">{label}</span>}
          </>
        );
        return (
          <span
            className="flex min-w-0 shrink-0 items-center"
            key={`${String(index)}:${label}`}
            onPointerEnter={() => {
              point(index);
            }}
          >
            {index > 0 ? separator : null}
            {part(index, content)}
          </span>
        );
      })}
      {/* The whole trail at its natural width, out of sight, for the parts
          to be measured against. Held in a box of no size, so the trail
          never scrolls onto it. */}
      <span
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden"
      >
        <span className="flex w-max items-center" ref={natural}>
          {labels.map((label, index) => {
            const markOf = mark(index);
            const hasMark = markOf !== null && markOf !== undefined;
            return (
              <span
                className={cn("flex items-center", labelClassName)}
                data-crumb=""
                key={`${String(index)}:${label}`}
              >
                {hasMark ? (
                  <span className="flex shrink-0" data-crumb-mark="">
                    {markOf}
                  </span>
                ) : null}
                <span
                  className={cn("whitespace-pre", hasMark && "ml-1")}
                  data-crumb-name=""
                >
                  {label}
                </span>
              </span>
            );
          })}
          <span className="flex" data-separator="">
            {separator}
          </span>
        </span>
      </span>
    </span>
  );
}
