import photoSrc from "@/client/assets/setup/vignette-photo.svg";
import { cn } from "@/client/lib/utils";
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf";
import { type CSSProperties, type ReactNode } from "react";

/**
 * Figma's Illustration/Vignette pieces: the little pages setup's pictures
 * are made of, at their size in the 560-wide pictures. They take their
 * colors from the `--vignette-*` tokens, so they follow the theme. A
 * picture drawn scaled down sets `--vignette-scale` to its scale, which
 * keeps each card's corner and edge at Figma's 9px and 1px on screen.
 */

/** A sheet: a green header row over a grid with one cell picked. */
export function SheetIllustration() {
  const columns = [0, 26.43, 48.62, 70.81];
  const widths = [25.43, 21.19, 21.19, 21.19];
  return (
    <IllustrationCard className="h-16 w-23 bg-vignette-ink-faint">
      {columns.map((left, index) => (
        <div
          className="absolute top-0 h-2.75 bg-vignette-head"
          key={left}
          style={{ left, width: widths[index] }}
        >
          <div className="absolute top-[4.5px] left-0.75 h-0.5 w-3 rounded-[1px] bg-brand-700 opacity-45" />
        </div>
      ))}
      {[12, 24, 36, 48, 60].map((top) =>
        columns.map((left, index) => (
          <div
            className={cn(
              "absolute h-2.75",
              index === 0 ? "bg-vignette-paper-muted" : "bg-vignette-paper",
              top === 36 && index === 2 && "border-2 border-brand-500",
            )}
            key={`${String(top)}-${String(left)}`}
            style={{ left, top, width: widths[index] }}
          >
            {index === 0 && (
              <div className="absolute top-[4.5px] left-0.75 h-0.5 w-3.5 rounded-[1px] bg-gray-600 opacity-30" />
            )}
          </div>
        )),
      )}
    </IllustrationCard>
  );
}

/** A document: a yellow kicker, a heading and four lines. */
export function DocIllustration() {
  return (
    <IllustrationCard className="h-20 w-24">
      <Bar className="top-2.25 left-2.25 h-1 w-[29.6px] bg-yellow-300" />
      <Bar className="top-4.5 left-2.25 h-1.5 w-[62.4px] bg-vignette-ink" />
      {[31, 39, 47, 55].map((top, index) => (
        <Bar
          className="left-2.25 h-0.75 rounded-[1.5px] bg-vignette-ink-faint"
          key={top}
          style={{ top, width: [73.3, 59.3, 68.6, 46.8][index] }}
        />
      ))}
    </IllustrationCard>
  );
}

/** A browser page: its address bar, a banner and three lines. */
export function PageIllustration() {
  return (
    <IllustrationCard className="h-18.5 w-25">
      <div className="absolute inset-x-0 top-0 h-3.5 bg-vignette-band" />
      <Bar className="top-1 left-5.5 h-1.5 w-14 rounded-[3px] bg-vignette-paper" />
      <Bar className="top-5.25 left-1.75 h-6 w-21.5 rounded-[5px] bg-linear-to-b from-vignette-banner-top to-vignette-banner-bottom" />
      <Bar className="top-12.5 left-1.75 h-1 w-[67px] bg-vignette-ink" />
      {[59, 67].map((top, index) => (
        <Bar
          className="left-1.75 h-0.75 rounded-[1.5px] bg-vignette-ink-faint"
          key={top}
          style={{ top, width: [81, 60][index] }}
        />
      ))}
    </IllustrationCard>
  );
}

/** A bar chart with its tallest bar picked out. */
export function ChartIllustration() {
  const bars: [left: number, top: number, height: number, faint: boolean][] = [
    [8, 50.36, 17.64, true],
    [23.2, 41.12, 26.88, true],
    [38.4, 47, 21, true],
    [53.6, 29.36, 38.64, false],
    [68.8, 37.76, 30.24, true],
  ];
  return (
    <IllustrationCard className="h-18 w-22">
      <Bar className="top-2 left-2 h-1 w-[38.9px] bg-vignette-ink" />
      <Bar className="top-3.75 left-2 h-0.75 w-[24.5px] bg-vignette-ink-faint" />
      {bars.map(([left, top, height, faint]) => (
        <div
          className={cn(
            "absolute w-[11.2px] bg-brand-500",
            faint && "opacity-30",
          )}
          key={left}
          style={{ height, left, top }}
        />
      ))}
      <div className="absolute top-17 left-2 h-px w-18 bg-vignette-edge" />
    </IllustrationCard>
  );
}

/**
 * A photo, a picture in either theme, its corners rounded to sit evenly
 * inside the card's, 4px in.
 */
export function PhotoIllustration() {
  return (
    <IllustrationCard className="h-18 w-15">
      <img
        alt=""
        className="absolute top-1 left-1 h-16 w-13 max-w-none rounded-[calc(9px/var(--vignette-scale,1)-4px)]"
        src={photoSrc}
      />
    </IllustrationCard>
  );
}

/** A PDF, by its icon. */
export function PdfIllustration() {
  return (
    <IllustrationCard className="flex h-17 w-14 items-center justify-center text-brand-500">
      <FilePdfIcon className="size-5.5" />
    </IllustrationCard>
  );
}

function IllustrationCard({
  children,
  className,
}: {
  children?: ReactNode;
  className: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[calc(9px/var(--vignette-scale,1))] bg-vignette-paper shadow-[0_0_0_calc(1px/var(--vignette-scale,1))_var(--color-vignette-edge),0_1px_2px_-1px_rgb(10_13_18/0.06),0_2px_4px_0_rgb(10_13_18/0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Bar({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  return <div className={cn("absolute rounded-xs", className)} style={style} />;
}
