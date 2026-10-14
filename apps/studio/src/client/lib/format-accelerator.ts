import { currentOs } from "@/client/lib/utils";
import {
  formatAcceleratorFor,
  formatAcceleratorTextFor,
} from "@/shared/format-accelerator";
import { type ShortcutAccelerator } from "@/shared/shortcuts";

/**
 * Splits an Electron accelerator into the keys to draw, in the order this
 * window's system writes them. One token per `<Kbd>`.
 */
export function formatAccelerator(accelerator: ShortcutAccelerator): string[] {
  return formatAcceleratorFor({ accelerator, os: currentOs() });
}

/** The accelerator as one string for running text on this window's system. */
export function formatAcceleratorText(accelerator: ShortcutAccelerator) {
  return formatAcceleratorTextFor({ accelerator, os: currentOs() });
}
