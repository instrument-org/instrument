import { isMacOS, isWindows } from "@/client/lib/utils";

/**
 * What the sidebar calls the computer: the name each platform's own file
 * browser gives it, so the place reads as familiar rather than as a Mac
 * dressed up on a machine that is not one.
 */
export function computerName(): string {
  if (isMacOS()) {
    return "This Mac";
  }
  return isWindows() ? "This PC" : "This Computer";
}
