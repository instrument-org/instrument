import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `max-h-none` is a real Tailwind utility, but tailwind-merge leaves `none` out
// of its `max-h` class group. Without this, `cn("max-h-96", "max-h-none")` keeps
// both classes and stylesheet order decides the winner instead of the caller.
// The floating shadows (`globals.css`) join the shadow scale, so a caller's
// `shadow-lg` replaces a primitive's `shadow-float-sm` rather than stacking.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "max-h": [{ "max-h": ["none"] }] },
    theme: { shadow: ["float-sm", "float-md", "float-lg"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** What the system's own file manager is called here, for a row that hands a file to it. */
export function getFileManagerName(): string {
  if (isMacOS()) {
    return "Finder";
  }
  if (isWindows()) {
    return "File Explorer";
  }
  return "File Manager";
}

export function getRevealInFolderLabel(): string {
  if (isMacOS()) {
    return "Reveal in Finder";
  }
  if (isWindows()) {
    return "Reveal in File Explorer";
  }
  return "Show in file manager";
}

export function isLinux(): boolean {
  return window.electron.process.platform === "linux";
}

export function isMacOS(): boolean {
  return window.electron.process.platform === "darwin";
}

export function isWindows(): boolean {
  return window.electron.process.platform === "win32";
}

const WHEEL_LINE_TO_PX = 16;

// deltaY is pixels for trackpad pinch and most wheels, but lines when
// `deltaMode` is 1, so line deltas are normalized to px first.
export function normalizeWheelDeltaPx(event: WheelEvent) {
  return event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_TO_PX : event.deltaY;
}
