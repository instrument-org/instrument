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

/**
 * Each system's folder in the app's own drawing: the Finder's blue, File
 * Explorer's amber, and the orange of Ubuntu's default Yaru theme, each with
 * its front shaped the way that system's folder is.
 */
const FOLDERS: Record<
  Os,
  { back: [string, string]; front: [string, string]; shape: string }
> = {
  linux: {
    back: ["#b8380f", "#972305"],
    front: ["#e66c3d", "#d4552a"],
    shape: STEPPED_FRONT,
  },
  mac: {
    back: ["#3dabf5", "#1d84dd"],
    front: ["#7accfb", "#37a0ef"],
    shape: FLAT_FRONT,
  },
  windows: {
    back: ["#ffc929", "#eea60c"],
    front: ["#ffe69a", "#fdc844"],
    shape: STEPPED_FRONT,
  },
};

/** The folder drawn for `os`, as an SVG document. */
export function folderGlyphSvg(os: Os) {
  const { back, front, shape } = FOLDERS[os];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 50" width="64" height="50"><defs><linearGradient id="back" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${back[0]}"/><stop offset="1" stop-color="${back[1]}"/></linearGradient><linearGradient id="front" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${front[0]}"/><stop offset="1" stop-color="${front[1]}"/></linearGradient></defs><path d="${BACK}" fill="url(#back)"/><path d="${shape}" fill="url(#front)"/></svg>`;
}

const urls = new Map<Os, string>();

/** The folder of the system the app runs on, as an image address. */
export function folderGlyphUrl(os: Os = currentOs()) {
  let url = urls.get(os);
  if (url === undefined) {
    url = `data:image/svg+xml,${encodeURIComponent(folderGlyphSvg(os))}`;
    urls.set(os, url);
  }
  return url;
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
