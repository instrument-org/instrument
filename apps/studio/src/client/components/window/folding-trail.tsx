import { fitMiddle, fontOf, type TextFont } from "@/client/lib/middle-truncate";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

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
export function shareWidths(
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
        0,
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

/**
 * A trail of names on one line, a path or the parts of a place, that gives
 * way the way a folder window's path bar does as its box narrows: the names
 * shorten first, cut in their middles, longest first; then every folder
 * between the first and the one before the last folds to its mark at once,
 * then the first, then the one before the last, so the marks still count the
 * folders; and last of all the last name is cut. Pointing at a part shows its
 * whole name in place, growing out of its mark or its cut.
 *
 * Each part is its mark (`mark`, which may be none, and then it never folds)
 * and its name, wrapped by `part` in whatever it is pressed as, with the
 * separator before it when it is not the first. The parts are measured off a
 * copy drawn out of sight, so `labelClassName` is a part's padding for that
 * measure, and `reserve` is room the trail takes beyond its parts.
 */
export function FoldingTrail({
  className,
  labelClassName,
  labels,
  mark,
  part,
  reserve = 0,
  separator,
}: {
  className?: string;
  /** Each part's padding, measured with its mark and name. */
  labelClassName?: string;
  labels: string[];
  /** The mark a part shows before its name, and folds to. */
  mark: (index: number) => ReactNode;
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
    const crumbs = [...copy.querySelectorAll<HTMLElement>("[data-crumb]")];
    const sizes = crumbs.map((crumb): PartSize => {
      const markOf = crumb.querySelector<HTMLElement>("[data-crumb-mark]");
      const name = crumb.querySelector<HTMLElement>("[data-crumb-name]");
      const nameWidth = name?.offsetWidth ?? 0;
      const gap =
        markOf && name
          ? name.offsetLeft - (markOf.offsetLeft + markOf.offsetWidth)
          : 0;
      return {
        gap,
        markOnly: crumb.offsetWidth - nameWidth - gap,
        name: nameWidth,
      };
    });
    const hasMark = crumbs.map(
      (crumb) => crumb.querySelector("[data-crumb-mark]") !== null,
    );
    const separatorWidth =
      copy.querySelector<HTMLElement>("[data-separator]")?.offsetWidth ?? 0;
    const total =
      sizes.reduce(
        (sum, size) => sum + size.markOnly + size.gap + size.name,
        0,
      ) +
      separatorWidth * Math.max(0, sizes.length - 1) +
      reserve;
    const fit = () => {
      setFits({
        font,
        parts: fitTrail(sizes, {
          // About four letters and the ellipsis: shorter than that, a cut
          // name says less than the folder's mark does.
          floor: fontSize * 4,
          hasMark,
          reserve,
          separator: separatorWidth,
          width: element.clientWidth,
        }),
        total,
        trail,
      });
    };
    fit();
    const observer = new ResizeObserver(() => {
      setMoving([]);
      fit();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [reserve, trail]);
  const current = fits.trail === trail ? fits : undefined;
  const point = (index: number | null) => {
    setMoving([pointedAt, index].filter((one): one is number => one !== null));
    setPointedAt(index);
  };
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
        const fit = current?.parts[index] ?? { kind: "whole" };
        const isPointed = pointedAt === index;
        const shown =
          isPointed || fit.kind === "whole"
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
          to be measured against. */}
      <span
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center"
        ref={natural}
      >
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
  );
}
