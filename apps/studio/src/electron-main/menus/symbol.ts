import { nativeImage } from "electron";

/**
 * An SF Symbol beside a menu row, by its name in the SF Symbols app. macOS
 * draws one beside the rows of its own roles (Close Window, Copy, Minimize),
 * so a row of ours without one stands out among them; other systems draw
 * none beside theirs, so there it is left out.
 */
export function menuSymbol(name: string): { icon?: Electron.NativeImage } {
  return process.platform === "darwin"
    ? { icon: nativeImage.createMenuSymbol(name) }
    : {};
}
