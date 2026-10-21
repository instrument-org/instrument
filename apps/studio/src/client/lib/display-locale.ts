const region = globalThis.window?.api?.systemRegion;

/**
 * The locale every date and number on screen is formatted in: English words,
 * since the app is in English, with the conventions of the region the OS is
 * set to (`en-DE` writes `5 November`, `15:40` and `1.234,5`). Formatting with
 * the default locale instead follows the OS language, which puts a German
 * month name inside an English sentence.
 */
export const displayLocale = region ? `en-${region}` : "en-US";
