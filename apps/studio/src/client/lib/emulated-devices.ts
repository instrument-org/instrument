import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { atom } from "jotai";

// Presets for the browser panel's "View as" menu (see browser-panel.tsx).
// Sizes are CSS px layout viewports, matching what a real device's browser
// reports for `window.innerWidth`/`innerHeight`. Named as broad categories
// (not specific phone models) since the menu is for a general audience
// checking how a page looks on roughly a phone/tablet/laptop, not testing an
// exact device.
export interface EmulatedDevice {
  height: number;
  id: string;
  label: string;
  width: number;
}

export const EMULATED_DEVICES: EmulatedDevice[] = [
  { height: 844, id: "mobile", label: "Mobile", width: 390 },
  { height: 1180, id: "tablet", label: "Tablet", width: 820 },
  { height: 900, id: "desktop", label: "Desktop", width: 1440 },
];

/**
 * The device each page is viewed as, by its guest; a page not named is at
 * its panel's own size. Kept beside the panel so a menu outside it (a page's
 * file, whose menu is the file's) can set it too.
 */
export const emulatedDevicesAtom = atom<
  Readonly<Partial<Record<BrowserTargetId, EmulatedDevice>>>
>({});
