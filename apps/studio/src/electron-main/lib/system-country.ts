import { app } from "electron";

/**
 * The country the OS region setting names, as a two-letter ISO code, or
 * undefined when the setting names none or names a wider region ("419" for
 * Latin America). Read from the machine alone, so it costs no request and no
 * permission, and it says only what the user told their OS.
 */
export function systemCountry(): string | undefined {
  try {
    const region = new Intl.Locale(app.getSystemLocale()).region;
    return region && /^[A-Z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The launch argument that hands a window's preload the OS region, which
 * dates and numbers on screen are formatted by. The renderer cannot read it:
 * its own locale follows the OS language.
 */
export function systemRegionArguments(): string[] {
  const country = systemCountry();
  return country ? [`--systemRegion=${country}`] : [];
}
