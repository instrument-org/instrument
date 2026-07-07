import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
