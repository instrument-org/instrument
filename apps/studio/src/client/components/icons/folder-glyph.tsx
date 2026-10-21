import { cn, currentOs } from "@/client/lib/utils";
import { type Os } from "@/shared/os-conventions";

/** The folder's back: its tab and the strip above the front, in a 64×50 box. */
const BACK =
  "M5 10c0-3.31 2.69-6 6-6h10.9c1.6 0 3.13.7 4.18 1.9l1.5 1.73a3.5 3.5 0 0 0 2.64 1.22H54c2.76 0 5 2.24 5 5V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V10Z";

/** A front cut straight across, as the Finder draws it. */
const FLAT_FRONT =
  "M5 15.5h54V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V15.5Z";

/**
 * A front that steps up past the tab, as File Explorer and Ubuntu's Yaru
 * folders are drawn: lower under the tab, higher across the rest.
 */
const STEPPED_FRONT =
  "M5 18.5c0-1.1.9-2 2-2h13.6c.95 0 1.85-.4 2.5-1.1l1.8-2.1c.65-.75 1.6-1.15 2.55-1.15H55c2.2 0 4 1.8 4 4V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V18.5Z";

/** Each system's folder front: the Finder's is flat, Explorer's and Yaru's step up. */
const SHAPES: Record<Os, string> = {
  linux: STEPPED_FRONT,
  mac: FLAT_FRONT,
  windows: STEPPED_FRONT,
};

type Gradient = [top: string, bottom: string];

/**
 * Each system's folder in the app's own drawing: the Finder's blue, File
 * Explorer's amber, and the orange of Ubuntu's default Yaru theme.
 */
const COLORS: Record<Os, { back: Gradient; front: Gradient }> = {
  linux: { back: ["#b8380f", "#972305"], front: ["#e66c3d", "#d4552a"] },
  mac: { back: ["#3dabf5", "#1d84dd"], front: ["#7accfb", "#37a0ef"] },
  windows: { back: ["#ffc929", "#eea60c"], front: ["#ffe69a", "#fdc844"] },
};

/**
 * Instrument's output folder: the system's folder in the desktop folder
 * icon's teal, with the Instrument mark pressed into the front.
 */
const OUTPUT_COLORS = {
  back: ["#2eb3a8", "#138a80"],
  front: ["#6fd8cb", "#2aa79c"],
} satisfies { back: Gradient; front: Gradient };
const OUTPUT_MARK = `<path id="mark" d="M-47-17A50 50 0 0 1 47-17Z M-49-10H-14A10 10 0 0 1-14 10H-49A50 50 0 0 1-49-10Z M49-10H14A10 10 0 0 0 14 10H49A50 50 0 0 0 49-10Z M-47 17H47A50 50 0 0 1-47 17Z"/>`;
const OUTPUT_MARK_USES = `<use href="#mark" transform="translate(32 31.75) scale(0.115)" fill="#ffffff" opacity="0.35"/><use href="#mark" transform="translate(32 31.5) scale(0.115)" fill="#0f7a71" opacity="0.7"/>`;

function gradient(id: string, [top, bottom]: Gradient) {
  return `<linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
}

/** The folder drawn for `os`, as an SVG document; Instrument's own when `output`. */
function folderGlyphSvg(os: Os, output: boolean) {
  const { back, front } = output ? OUTPUT_COLORS : COLORS[os];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 50" width="64" height="50"><defs>${gradient("back", back)}${gradient("front", front)}${output ? OUTPUT_MARK : ""}</defs><path d="${BACK}" fill="url(#back)"/><path d="${SHAPES[os]}" fill="url(#front)"/>${output ? OUTPUT_MARK_USES : ""}</svg>`;
}

const urls = new Map<string, string>();

function glyphUrl(os: Os, output: boolean) {
  const key = `${os}${output ? ":output" : ""}`;
  let url = urls.get(key);
  if (url === undefined) {
    url = `data:image/svg+xml,${encodeURIComponent(folderGlyphSvg(os, output))}`;
    urls.set(key, url);
  }
  return url;
}

/** The folder of the system the app runs on, as an image address. */
export function folderGlyphUrl(os: Os = currentOs()) {
  return glyphUrl(os, false);
}

/** Instrument's output folder in the shape of the system's own, as an image address. */
export function outputFolderGlyphUrl(os: Os = currentOs()) {
  return glyphUrl(os, true);
}

/**
 * A folder, drawn the way the system the app runs on draws one, centered in
 * a square: the mark for a folder anywhere outside the file browser's rows.
 */
export function SystemFolderIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- The folder glyph is an inline SVG data URL.
    <img
      alt=""
      aria-hidden="true"
      className={cn("object-contain", className)}
      draggable={false}
      src={folderGlyphUrl()}
    />
  );
}
