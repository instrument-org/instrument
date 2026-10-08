import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrandMark } from "@/client/components/brand-mark";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { cn } from "@/client/lib/utils";
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { type CSSProperties, type ReactNode } from "react";

/**
 * The drawings on the setup pages every way in shares: memories, the folder,
 * notifications, and the look. Static, drawn in the app's own shapes rather
 * than screenshots, so they stay sharp at any zoom.
 */

/** The app's icon at a size. */
export function SetupAppIcon({ size }: { size: number }) {
  return (
    <BrandMark
      className="shrink-0 drop-shadow-[0_8px_14px_rgba(11,96,86,0.35)]"
      size={size}
    />
  );
}

/** A rounded square in a hue at 13%, with its glyph in the hue. */
export function SetupWell({
  children,
  hue,
  size = 30,
}: {
  children: ReactNode;
  hue: string;
  size?: number;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{
        backgroundColor: `color-mix(in srgb, ${hue} 13%, var(--color-card))`,
        borderRadius: Math.round(size * 0.3),
        color: `color-mix(in srgb, ${hue} 70%, var(--color-foreground))`,
        fontSize: Math.round(size * 0.55),
        height: size,
        width: size,
      }}
    >
      {children}
    </span>
  );
}

export type MemoryApp = "chatgpt" | "claude" | "gemini";

const MEMORY_APP_ICON = {
  chatgpt: "openai",
  claude: "anthropic",
  gemini: "google",
} as const;

/** Another app's mark on a white tile. */
export function MarkTile({ app, size }: { app: MemoryApp; size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center bg-white ring-1 ring-black/[0.08]"
      style={{
        borderRadius: Math.round(size * 0.27),
        height: size,
        width: size,
      }}
    >
      <AIProviderIcon
        className={cn(
          size > 40 ? "size-7" : "size-5",
          app === "chatgpt" && "text-black",
        )}
        colored
        type={MEMORY_APP_ICON[app]}
      />
    </span>
  );
}

/** F5: the three apps, an arrow, and Instrument wearing memory's fingerprint. */
export function MemoriesArt() {
  return (
    <div className="flex items-center gap-6">
      <div className="flex -space-x-2">
        <MarkTile app="chatgpt" size={52} />
        <MarkTile app="claude" size={52} />
        <MarkTile app="gemini" size={52} />
      </div>
      <svg aria-hidden height="20" viewBox="0 0 70 20" width="70">
        <path
          d="M2 10H62"
          stroke="#a8a29e"
          strokeDasharray="3 5"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <path
          d="M58 4l7 6-7 6"
          fill="none"
          stroke="#a8a29e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
      <span className="relative inline-block">
        <SetupAppIcon size={68} />
        <span className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-white text-brand-700 shadow-[0_4px_10px_-3px_rgba(11,96,86,0.45)] ring-1 ring-black/[0.08]">
          <FingerprintIcon className="size-4.25" />
        </span>
      </span>
    </div>
  );
}

/** The folder glyph the app's file views draw, for the Location row. */
export function LocationFolderGlyph() {
  return <FileSystemFolderGlyph className="h-6 w-7.5 shrink-0" />;
}

// ---- the folder, packed ----------------------------------------------------

const MARK_PATH =
  "M-47-17A50 50 0 0 1 47-17Z M-49-10H-14A10 10 0 0 1-14 10H-49A50 50 0 0 1-49-10Z M49-10H14A10 10 0 0 0 14 10H49A50 50 0 0 0 49-10Z M-47 17H47A50 50 0 0 1-47 17Z";

function FolderBack({ size }: { size: number }) {
  return (
    <svg height={size} viewBox="0 0 512 512" width={size}>
      <defs>
        <linearGradient id="setup-folder-back" x2="0" y2="1">
          <stop stopColor="#36b5ad" />
          <stop offset="1" stopColor="#0b625b" />
        </linearGradient>
      </defs>
      <path
        d="M24 146V90Q24 66 48 66H145Q156 66 163 75L175 90Q180 96 190 96H464Q488 96 488 120V414Q488 442 460 442H52Q24 442 24 414Z"
        fill="url(#setup-folder-back)"
        stroke="#126f68"
        strokeWidth="2"
      />
    </svg>
  );
}

function FolderFront({ size }: { size: number }) {
  return (
    <svg height={size} viewBox="0 0 512 512" width={size}>
      <defs>
        <linearGradient id="setup-folder-front" x2="0.2" y2="1">
          <stop stopColor="#249f98" />
          <stop offset="0.48" stopColor="#14817b" />
          <stop offset="1" stopColor="#0c6059" />
        </linearGradient>
        <linearGradient id="setup-folder-edge" x2="0" y2="1">
          <stop stopColor="#89ddd4" stopOpacity="0.8" />
          <stop offset="1" stopColor="#064e49" stopOpacity="0.6" />
        </linearGradient>
        <path d={MARK_PATH} id="setup-folder-mark" />
      </defs>
      <path
        d="M44 143H468Q490 143 490 165V416Q490 441 465 441H47Q22 441 22 416V165Q22 143 44 143Z"
        fill="#053f3b"
        opacity="0.18"
        transform="translate(0 3)"
      />
      <rect
        fill="url(#setup-folder-front)"
        height="302"
        rx="23"
        stroke="url(#setup-folder-edge)"
        strokeWidth="2"
        width="468"
        x="22"
        y="140"
      />
      <use
        fill="#67c1b6"
        href="#setup-folder-mark"
        opacity="0.4"
        transform="translate(256 297)"
      />
      <use
        fill="#075b55"
        href="#setup-folder-mark"
        opacity="0.85"
        transform="translate(256 295)"
      />
    </svg>
  );
}

type Vignette = "chart" | "doc" | "pdf" | "photo" | "sheet";

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

function VignetteContent({ kind }: { kind: Vignette }) {
  switch (kind) {
    case "doc":
      return (
        <div className="flex flex-col gap-1.25 p-2.25">
          <Line color="#e8793a" height={4} width="38%" />
          <Line color="rgba(28,25,23,.7)" height={6} width="80%" />
          <div className="h-0.5" />
          <Line width="94%" />
          <Line width="76%" />
          <Line width="88%" />
          <Line width="60%" />
        </div>
      );
    case "sheet":
      return (
        <div className="grid h-full auto-rows-[11px] grid-cols-[1.2fr_1fr_1fr_1fr] gap-px bg-[rgba(28,25,23,.08)]">
          {Array.from({ length: 24 }, (_, n) => {
            const row = Math.floor(n / 4);
            const column = n % 4;
            return (
              <div
                className={cn(
                  "flex items-center px-0.75",
                  row === 0
                    ? "bg-[#dfeee9]"
                    : column === 0
                      ? "bg-[#f7f6f3]"
                      : "bg-white",
                )}
                key={n}
              >
                {(row === 0 || column === 0) && (
                  <Line
                    color={
                      row === 0 ? "rgba(11,96,86,.45)" : "rgba(28,25,23,.16)"
                    }
                    height={2}
                    width="58%"
                  />
                )}
              </div>
            );
          })}
        </div>
      );
    case "chart":
      return (
        <div className="flex flex-col p-2">
          <Line color="rgba(28,25,23,.62)" height={4} width="54%" />
          <div className="h-0.75" />
          <Line width="34%" />
          <div className="mt-2 flex h-7 w-full items-end gap-1 shadow-[0_1px_0_rgba(28,25,23,.12)]">
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
      );
    case "photo":
      return (
        <div className="h-full p-1">
          <div className="h-full rounded-[5px] bg-[linear-gradient(180deg,#9cc2e3_0%,#dde3e2_42%,#f5d7a6_62%,#ecb684_100%)]" />
        </div>
      );
    case "pdf":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 bg-white">
          <FilePdfIcon className="size-5.5 text-[#d14b3f]" />
          <div className="h-0.75 w-7 rounded-full bg-black/10" />
        </div>
      );
  }
}

const FAN: [
  kind: Vignette,
  w: number,
  h: number,
  rot: number,
  reach: number,
][] = [
  ["photo", 60, 72, -60, 94],
  ["sheet", 92, 64, -30, 60],
  ["doc", 96, 80, 0, 36],
  ["chart", 88, 72, 30, 60],
  ["pdf", 56, 68, 60, 94],
];

/** F6: the Instrument folder with five things it holds fanned out of it. */
export function PackedFolderArt() {
  const size = 190;
  const k = size / 512;
  const width = 560;
  const left = (width - size) / 2;
  const top = 18;
  const pocket = top + 140 * k;
  return (
    <div
      aria-hidden
      className="relative"
      style={{ height: Math.round(top + 446 * k), width }}
    >
      <div
        className="absolute h-5.5 bg-[radial-gradient(closest-side,rgba(11,74,67,.22),rgba(11,74,67,0))]"
        style={{
          left: left + 0.12 * size,
          top: top + 432 * k,
          width: 0.76 * size,
        }}
      />
      <div className="absolute z-1" style={{ left, top }}>
        <FolderBack size={size} />
      </div>
      {FAN.map(([kind, w, h, rot, reach]) => {
        const turn = (rot * Math.PI) / 180;
        const x = width / 2 + (reach + h / 2) * Math.sin(turn);
        const y = pocket + 52 - (reach + h / 2) * Math.cos(turn);
        const style: CSSProperties = {
          height: h,
          left: x - w / 2,
          top: y - h / 2,
          transform: `rotate(${rot}deg)`,
          width: w,
          zIndex: 5 - Math.abs(rot) / 30,
        };
        return (
          <div
            className="absolute overflow-hidden rounded-[9px] bg-white shadow-[0_0_0_1px_rgba(28,25,23,.07),0_1px_2px_rgba(28,25,23,.06),0_8px_18px_-6px_rgba(28,25,23,.24)]"
            key={kind}
            style={style}
          >
            <VignetteContent kind={kind} />
          </div>
        );
      })}
      <div className="absolute z-10" style={{ left, top }}>
        <FolderFront size={size} />
      </div>
    </div>
  );
}

// ---- notifications ---------------------------------------------------------

function GhostWindow({
  className,
  height,
  left,
  top,
  width,
}: {
  className?: string;
  height: number;
  left: number;
  top: number;
  width: number;
}) {
  return (
    <div
      className={cn(
        "absolute rounded-[14px] border border-foreground/[0.14] bg-card/60",
        className,
      )}
      style={{ height, left, top, width }}
    >
      <div className="h-7 rounded-t-[13px] border-b border-foreground/10 bg-foreground/[0.025]" />
    </div>
  );
}

/** F8: a notification turning up over two plain windows. */
export function NotificationArt() {
  return (
    <div aria-hidden className="relative h-49 w-117.5">
      <GhostWindow height={150} left={10} top={34} width={250} />
      <GhostWindow
        className="z-1"
        height={172}
        left={92}
        top={10}
        width={290}
      />
      <div className="absolute top-14.5 left-41.5 z-10 flex w-75 items-start gap-3 rounded-2xl bg-card/95 p-3.5 text-left shadow-[0_18px_40px_-14px_rgba(28,25,23,.38)] ring-1 ring-black/[0.07]">
        <BrandMark className="shrink-0" size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center text-[11px] text-foreground/45">
            <span className="flex-1 font-medium tracking-wide uppercase">
              Instrument
            </span>
            <span>now</span>
          </div>
          <div className="mt-1 text-[13px] leading-snug font-semibold text-foreground">
            Competitor prices are ready
          </div>
          <div className="mt-0.5 text-[13px] leading-snug text-foreground/65">
            Three bakeries, four products. Open it to see the page.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- the look --------------------------------------------------------------

/** A tiny Instrument window in one theme: the rail, the inbox, a thread. */
function MiniWindow({ dark }: { dark: boolean }) {
  const ground = dark ? "#1c1917" : "#e7e5e4";
  const card = dark ? "#292524" : "#ffffff";
  const line = dark ? "#44403c" : "#e7e5e4";
  const tile = dark ? "#57534e" : "#d6d3d1";
  return (
    <div className="absolute inset-0" style={{ background: ground }}>
      <div className="absolute top-6 left-2 flex flex-col items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-brand-700" />
        {[0, 1, 2, 3].map((index) => (
          <span
            className="size-1.75 rounded-[2px]"
            key={index}
            style={{ background: tile }}
          />
        ))}
      </div>
      <div
        className="absolute top-5 right-1.5 bottom-1.5 left-6.5 flex overflow-hidden rounded-md"
        style={{ background: card }}
      >
        <div
          className="w-[38%] space-y-1.5 border-r p-1.75"
          style={{ borderColor: line }}
        >
          {[90, 70, 80, 60, 75].map((width) => (
            <div
              className="h-1 rounded-full"
              key={width}
              style={{ background: line, width: `${width}%` }}
            />
          ))}
        </div>
        <div className="flex-1 space-y-1.5 p-2">
          <div
            className="ml-auto h-2.5 w-[55%] rounded-[5px] bg-[#bcdcd2]"
            style={{ opacity: dark ? 0.55 : 1 }}
          />
          <div
            className="h-4 w-[80%] rounded-[5px]"
            style={{ background: line }}
          />
          <div
            className="h-2.5 w-[60%] rounded-[5px]"
            style={{ background: line }}
          />
        </div>
      </div>
    </div>
  );
}

/** F12: the app in light, dark, or split along the diagonal for automatic. */
export function LookMiniature({ look }: { look: "dark" | "light" | "system" }) {
  return (
    <div className="relative h-37.5 w-58 overflow-hidden rounded-[11px]">
      {look === "system" ? (
        <>
          <MiniWindow dark={false} />
          <div className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]">
            <MiniWindow dark />
          </div>
        </>
      ) : (
        <MiniWindow dark={look === "dark"} />
      )}
    </div>
  );
}
