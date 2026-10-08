import { BrandMark } from "@/client/components/brand-mark";
import { cn } from "@/client/lib/utils";
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

/**
 * Welcome's hero: the app icon fades in, then six things Instrument makes pop
 * out from behind it. It plays the first time Welcome opens, and not at all
 * under Reduce Motion, where everything starts in place.
 */
export function WelcomeHero() {
  const [animate] = useState(() => !heroPlayed);
  useEffect(() => {
    heroPlayed = true;
  }, []);
  return (
    <div
      className="relative h-49 w-140"
      data-hero-play={animate || undefined}
      aria-hidden
    >
      <style href="setup-welcome-hero" precedence="default">
        {HERO_CSS}
      </style>
      {BURST.map((card, index) => (
        <div
          className="absolute"
          data-hero="card"
          key={card.kind}
          // Custom properties aren't among CSSProperties' keys, hence the cast.
          style={
            {
              "--delay": `${0.85 + index * 0.06}s`,
              "--dx": `${-card.x}px`,
              "--dy": `${-card.y}px`,
              "--rot": `${card.rot}deg`,
              height: card.h,
              left: STAGE.cx + card.x - card.w / 2,
              top: STAGE.cy + card.y - card.h / 2,
              width: card.w,
              zIndex: card.layer,
            } as CSSProperties
          }
        >
          <VignetteCard>
            {VIGNETTES[card.kind]({ h: card.h, w: card.w })}
          </VignetteCard>
        </div>
      ))}
      <div
        className="absolute z-10"
        data-hero="icon"
        style={{ left: STAGE.cx - 52, top: STAGE.cy - 52 }}
      >
        <BrandMark className="size-26" size={104} />
      </div>
    </div>
  );
}

// Once per launch: Back to Welcome finds the hero already in place.
let heroPlayed = false;

const STAGE = { cx: 280, cy: 96 };

type VignetteKind = "chart" | "doc" | "page" | "pdf" | "photo" | "sheet";

// Listed in the order they come out, one side then the other; x and y place
// each card's center from the icon's.
const BURST: {
  h: number;
  kind: VignetteKind;
  layer: number;
  rot: number;
  w: number;
  x: number;
  y: number;
}[] = [
  { h: 64, kind: "sheet", layer: 2, rot: -6, w: 92, x: -84, y: -40 },
  { h: 74, kind: "page", layer: 2, rot: 5, w: 100, x: 78, y: -42 },
  { h: 80, kind: "doc", layer: 3, rot: -9, w: 96, x: -128, y: 22 },
  { h: 72, kind: "chart", layer: 3, rot: 8, w: 88, x: 128, y: 20 },
  { h: 72, kind: "photo", layer: 4, rot: 7, w: 60, x: -62, y: 54 },
  { h: 68, kind: "pdf", layer: 4, rot: -8, w: 56, x: 68, y: 56 },
];

const HERO_CSS = `
[data-hero="card"] { transform: rotate(var(--rot)); }
[data-hero-play] [data-hero="icon"] {
  animation: setup-hero-icon 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-hero-play] [data-hero="card"] {
  animation:
    setup-hero-card 0.85s cubic-bezier(0.3, 1.32, 0.52, 1) var(--delay) both,
    setup-hero-fade 0.2s linear var(--delay) both;
}
@keyframes setup-hero-icon {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes setup-hero-card {
  from { transform: translate(var(--dx), var(--dy)) scale(0.45) rotate(0deg); }
  to { transform: translate(0, 0) scale(1) rotate(var(--rot)); }
}
@keyframes setup-hero-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  [data-hero-play] [data-hero="icon"],
  [data-hero-play] [data-hero="card"] { animation: none; }
}
`;

/** A card the size of what it shows, with a hairline edge and a soft shadow. */
function VignetteCard({ children }: { children: ReactNode }) {
  return (
    <div className="size-full overflow-hidden rounded-[9px] bg-white shadow-[0_0_0_1px_rgba(28,25,23,0.07),0_1px_2px_rgba(28,25,23,0.06),0_8px_18px_-6px_rgba(28,25,23,0.24)]">
      {children}
    </div>
  );
}

function Line({
  color = "rgba(28,25,23,.11)",
  height = 3,
  width,
}: {
  color?: string;
  height?: number;
  width: string;
}) {
  return (
    <div
      className="shrink-0 rounded-full"
      style={{ background: color, height, width }}
    />
  );
}

const VIGNETTES: Record<
  VignetteKind,
  (size: { h: number; w: number }) => ReactNode
> = {
  chart: ({ h, w }) => (
    <div className="flex flex-col p-2">
      <Line color="rgba(28,25,23,.62)" height={4} width="54%" />
      <div className="h-0.75" />
      <Line width="34%" />
      <div
        className="mt-2 flex w-full items-end gap-1 shadow-[0_1px_0_rgba(28,25,23,0.12)]"
        style={{ height: Math.round(Math.min(h - 30, w * 0.48)) }}
      >
        {[42, 64, 50, 92, 72].map((value, index) => (
          <div
            className="flex-1 rounded-t-[2px]"
            key={index}
            style={{
              background: index === 3 ? "#14a093" : "rgba(20,160,147,.3)",
              height: `${value}%`,
            }}
          />
        ))}
      </div>
    </div>
  ),
  doc: () => (
    <div className="flex flex-col gap-1.25 p-2.25">
      <Line color="#e8793a" height={4} width="38%" />
      <Line color="rgba(28,25,23,.7)" height={6} width="80%" />
      <div className="h-0.5" />
      <Line width="94%" />
      <Line width="76%" />
      <Line width="88%" />
      <Line width="60%" />
    </div>
  ),
  page: ({ w }) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-3.5 shrink-0 items-center justify-center bg-[#f3f1ed] shadow-[inset_0_-1px_0_rgba(28,25,23,0.07)]">
        <span
          className="h-1.5 rounded-full bg-white shadow-[0_0_0_1px_rgba(28,25,23,0.07)]"
          style={{ width: Math.round(w * 0.56) }}
        />
      </div>
      <div className="flex flex-col gap-1.25 p-1.75">
        <div className="h-6 rounded-sm bg-[linear-gradient(140deg,#cddff2,#eaf0f7)]" />
        <Line color="rgba(28,25,23,.6)" height={4} width="78%" />
        <Line width="94%" />
        <Line width="70%" />
      </div>
    </div>
  ),
  pdf: ({ h }) => (
    <div
      className="flex h-full flex-col items-center gap-1 bg-white"
      style={{ paddingTop: Math.round(h / 2 - 17) }}
    >
      <FilePdfIcon className="size-5.5 text-[#d14b3f]" />
      <div className="h-0.75 w-7 rounded-full bg-black/10" />
    </div>
  ),
  photo: ({ h, w }) => (
    <div className="h-full p-1">
      <div
        className="relative h-full overflow-hidden rounded-[5px]"
        style={{
          background: `linear-gradient(180deg,#9cc2e3 0px,#dde3e2 ${Math.round(h * 0.42)}px,#f5d7a6 ${Math.round(h * 0.62)}px,#ecb684 ${h}px)`,
        }}
      >
        <span
          className="absolute left-[22%] rounded-full bg-[#fff5de] shadow-[0_0_10px_3px_rgba(255,240,210,0.75)]"
          style={{
            height: Math.round(w * 0.17),
            top: Math.round(h * 0.2),
            width: Math.round(w * 0.17),
          }}
        />
        <svg
          className="absolute inset-x-0 w-full"
          preserveAspectRatio="none"
          style={{
            height: `calc(100% - ${Math.round(h * 0.5)}px)`,
            top: Math.round(h * 0.5),
          }}
          viewBox="0 0 100 60"
        >
          <path d="M0 14C16 2 32 4 48 12S80 22 100 8V60H0Z" fill="#d99262" />
          <path d="M0 26C20 14 42 18 60 24S86 30 100 22V60H0Z" fill="#b8693f" />
        </svg>
      </div>
    </div>
  ),
  sheet: () => (
    <div className="grid h-full auto-rows-[11px] grid-cols-[1.2fr_1fr_1fr_1fr] gap-px bg-[rgba(28,25,23,0.08)]">
      {Array.from({ length: 40 }, (_, index) => {
        const row = Math.floor(index / 4);
        const column = index % 4;
        return (
          <div
            className={cn(
              "flex items-center px-0.75",
              row === 0
                ? "bg-[#dfeee9]"
                : column === 0
                  ? "bg-[#f7f6f3]"
                  : "bg-white",
              row === 3 && column === 2 && "shadow-[inset_0_0_0_1.5px_#14a093]",
            )}
            key={index}
          >
            {row === 0 ? (
              <Line color="rgba(11,96,86,.45)" height={2} width="60%" />
            ) : column === 0 ? (
              <Line color="rgba(28,25,23,.16)" height={2} width="55%" />
            ) : null}
          </div>
        );
      })}
    </div>
  ),
};
