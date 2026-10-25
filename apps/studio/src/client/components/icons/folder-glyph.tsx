import { cn, currentOs } from "@/client/lib/utils";
import { instrumentFolderOf } from "@/shared/instrument-folders";
import { type Os } from "@/shared/os-conventions";
import { type KeyFolderName } from "@instrument-org/workspace/client";

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

/**
 * The six key folders at the workspace's top level: the system's folder in
 * the app's brand green, with the mark the app draws for what each keeps
 * (Phosphor's bold weight, the icons the rail and settings use) on the
 * front, so the folders Instrument runs on read apart from the person's own.
 */
const KEY_COLORS = {
  back: ["#3f9a8b", "#0b6056"],
  front: ["#79c2b2", "#1f8a79"],
} satisfies { back: Gradient; front: Gradient };

/** Each key folder's mark, as Phosphor's bold paths on its 256-unit square. */
const KEY_MARKS = {
  Apps: "M71.49,60.55a12,12,0,0,0-23,0l-36,120A12,12,0,0,0,24,196H96a12,12,0,0,0,11.49-15.45ZM40.13,172,60,105.76,79.87,172ZM212,74a54,54,0,1,0-54,54A54.06,54.06,0,0,0,212,74Zm-84,0a30,30,0,1,1,30,30A30,30,0,0,1,128,74Zm96,70H136a12,12,0,0,0-12,12v52a12,12,0,0,0,12,12h88a12,12,0,0,0,12-12V156A12,12,0,0,0,224,144Zm-12,52H148V168h64Z",
  Chats:
    "M128,20A108,108,0,0,0,31.85,177.23L21,209.66A20,20,0,0,0,46.34,235l32.43-10.81A108,108,0,1,0,128,20Zm0,192a84,84,0,0,1-42.06-11.27,12,12,0,0,0-6-1.62,12.1,12.1,0,0,0-3.8.62l-29.79,9.93,9.93-29.79a12,12,0,0,0-1-9.81A84,84,0,1,1,128,212Z",
  Drafts:
    "M232.49,55.51l-32-32a12,12,0,0,0-17,0l-96,96A12,12,0,0,0,84,128v32a12,12,0,0,0,12,12h32a12,12,0,0,0,8.49-3.51l96-96A12,12,0,0,0,232.49,55.51ZM192,49l15,15L196,75,181,60Zm-69,99H108V133l56-56,15,15Zm105-7.43V208a20,20,0,0,1-20,20H48a20,20,0,0,1-20-20V48A20,20,0,0,1,48,28h67.43a12,12,0,0,1,0,24H52V204H204V140.57a12,12,0,0,1,24,0Z",
  Memory:
    "M160,128a224.48,224.48,0,0,1-26.37,105.54,12,12,0,1,1-21.16-11.32A200.33,200.33,0,0,0,136,128a8,8,0,0,0-16,0,12,12,0,0,1-24,0,32,32,0,0,1,64,0ZM128,56a12,12,0,1,0,0,24,48.05,48.05,0,0,1,48,48c0,7.62-.36,15.32-1.07,22.87A12,12,0,0,0,185.74,164c.38,0,.76,0,1.14,0a12,12,0,0,0,11.93-10.87c.79-8.3,1.18-16.76,1.18-25.13A72.08,72.080,0,0,0,128,56ZM96,92.23A12,12,0,0,0,80,74.35,72.1,72.1,0,0,0,56,128a120.11,120.11,0,0,1-15.12,58.37,12,12,0,0,0,21,11.69A144.14,144.14,0,0,0,80,128,48.08,48.08,0,0,1,96,92.23Zm10.1,64.1a12,12,0,0,0-14.46,8.9,158.61,158.61,0,0,1-18.88,45.86,12,12,0,0,0,20.5,12.48A182.86,182.86,0,0,0,115,170.79,12,12,0,0,0,106.1,156.33Zm76.73,24.07A12,12,0,0,0,168.19,189a241.5,241.5,0,0,1-8,24.87,12,12,0,0,0,6.91,15.49,11.76,11.76,0,0,0,4.29.8,12,12,0,0,0,11.21-7.71,260.2,260.2,0,0,0,8.79-27.37A12,12,0,0,0,182.83,180.4ZM128,16A112.12,112.12,0,0,0,16,127.44c0,.19,0,.38,0,.57a79.81,79.81,0,0,1-5,27.82,12,12,0,1,0,22.5,8.35A103.59,103.59,0,0,0,40,128.58c0-.19,0-.38,0-.57a88,88,0,0,1,176-.5c0,.16,0,.33,0,.5a282.12,282.12,0,0,1-6.74,61.38,12,12,0,0,0,9.09,14.33A11.84,11.84,0,0,0,221,204a12,12,0,0,0,11.7-9.38A305.87,305.87,0,0,0,240,128.55c0-.18,0-.36,0-.54A112.13,112.13,0,0,0,128,16Z",
  Skills:
    "M225.6,62.64l-88-48.17a19.91,19.91,0,0,0-19.2,0l-88,48.17A20,20,0,0,0,20,80.19v95.62a20,20,0,0,0,10.4,17.55l88,48.17a19.89,19.89,0,0,0,19.2,0l88-48.17A20,20,0,0,0,236,175.81V80.19A20,20,0,0,0,225.6,62.64ZM128,36.57,200,76,128,115.4,56,76ZM44,96.79l72,39.4v76.67L44,173.44Zm96,116.07V136.19l72-39.4v76.65Z",
  Topics:
    "M224,84H180.2l7.61-41.85a12,12,0,0,0-23.62-4.3L155.8,84H116.2l7.61-41.85a12,12,0,1,0-23.62-4.3L91.8,84H48a12,12,0,0,0,0,24H87.44l-7.27,40H32a12,12,0,0,0,0,24H75.8l-7.61,41.85a12,12,0,0,0,9.66,14A11.43,11.43,0,0,0,80,228a12,12,0,0,0,11.8-9.86L100.2,172h39.6l-7.61,41.85a12,12,0,0,0,9.66,14,11.43,11.43,0,0,0,2.16.2,12,12,0,0,0,11.8-9.86L164.2,172H208a12,12,0,0,0,0-24H168.56l7.27-40H224a12,12,0,0,0,0-24Zm-79.83,64H104.56l7.27-40h39.61Z",
} satisfies Record<KeyFolderName, string>;

/**
 * A key folder's mark on the front: white, with a darker copy a half pixel
 * under it so it reads as pressed in, about 17 units square in the front's
 * middle.
 */
function keyMarkUses(name: KeyFolderName) {
  const d = KEY_MARKS[name];
  return `<g transform="translate(23.6 22.9) scale(0.066)"><path d="${d}" transform="translate(0 8)" fill="#0a4a42" opacity="0.45"/><path d="${d}" fill="#ffffff" opacity="0.95"/></g>`;
}

/** What a folder glyph stands for: any folder, Instrument's output folder, or one of the key folders. */
type GlyphKind = "folder" | "output" | KeyFolderName;

/** The folder drawn for `os`, as an SVG document, in the look of `kind`. */
function folderGlyphSvg(os: Os, kind: GlyphKind) {
  const { back, front } =
    kind === "folder"
      ? COLORS[os]
      : kind === "output"
        ? OUTPUT_COLORS
        : KEY_COLORS;
  const defs = kind === "output" ? OUTPUT_MARK : "";
  const mark =
    kind === "folder"
      ? ""
      : kind === "output"
        ? OUTPUT_MARK_USES
        : keyMarkUses(kind);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 50" width="64" height="50"><defs>${gradient("back", back)}${gradient("front", front)}${defs}</defs><path d="${BACK}" fill="url(#back)"/><path d="${SHAPES[os]}" fill="url(#front)"/>${mark}</svg>`;
}

const urls = new Map<string, string>();

function glyphUrl(os: Os, kind: GlyphKind) {
  const key = `${os}:${kind}`;
  let url = urls.get(key);
  if (url === undefined) {
    url = `data:image/svg+xml,${encodeURIComponent(folderGlyphSvg(os, kind))}`;
    urls.set(key, url);
  }
  return url;
}

/** The folder of the system the app runs on, as an image address. */
export function folderGlyphUrl(os: Os = currentOs()) {
  return glyphUrl(os, "folder");
}

/** Instrument's output folder in the shape of the system's own, as an image address. */
export function outputFolderGlyphUrl(os: Os = currentOs()) {
  return glyphUrl(os, "output");
}

/** One of the workspace's key folders in the shape of the system's own, as an image address. */
export function keyFolderGlyphUrl(name: KeyFolderName, os: Os = currentOs()) {
  return glyphUrl(os, name);
}

/**
 * The glyph a folder wears in Files in place of the system's, as an image
 * address, or undefined for a folder that wears the system's: the output
 * folder its own, and each key folder at the workspace's top level its own
 * (`instrumentFolderOf`).
 */
export function instrumentFolderGlyphUrl(
  hostPath: string,
  places: { outputFolder: string | undefined; workspace: string | undefined },
  os: Os = currentOs(),
): string | undefined {
  if (hostPath === places.outputFolder) {
    return outputFolderGlyphUrl(os);
  }
  if (places.workspace === undefined) {
    return undefined;
  }
  const folder = instrumentFolderOf(hostPath, {
    os,
    workspace: places.workspace,
  });
  return folder?.kind === "key"
    ? keyFolderGlyphUrl(folder.name, os)
    : undefined;
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
