import { APP_NAME } from "@instrument-org/shared";
import { z } from "zod";

/** An extension the in-app browser runs, as main lists it and the window draws it. */
export const BrowserExtensionSchema = z.object({
  /** What its desktop app says of this browser; null for one with no app, or one not heard from yet. */
  connection: z.enum(["connected", "no-app", "refused"]).nullable(),
  description: z.string(),
  /** The app on this computer it talks to, when it has one, with that app's page on adding a browser. */
  desktopApp: z.object({ help: z.string(), name: z.string() }).nullable(),
  id: z.string(),
  name: z.string(),
  /** Whether its button is in the browser's row. */
  pinned: z.boolean(),
  version: z.string(),
});
export type BrowserExtension = z.output<typeof BrowserExtensionSchema>;

/**
 * What the window's extension buttons name the in-app browser's session by;
 * the main process maps the name to the session (`browser-view/extensions.ts`).
 */
export const BROWSER_EXTENSIONS_SESSION = "browser";

/** The Chrome Web Store, where an extension is added from, in a tab of the in-app browser. */
export const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";

/** An extension's own page on the Chrome Web Store. */
export function chromeWebStorePageOf(extensionId: string): string {
  return `${CHROME_WEB_STORE_URL}detail/${extensionId}`;
}

/**
 * The steps that get an extension's desktop app to take this browser, in
 * that app's own words, for the systems where it has a screen for it. Null
 * where it has none (Linux, where 1Password reads a file only root writes),
 * and the extension is used on its own instead.
 */
export function desktopAppSteps(
  appName: string,
  platform: "linux" | "mac" | "windows",
): null | string[] {
  if (platform === "linux") {
    return null;
  }
  return [
    `Open ${appName} and unlock it.`,
    "Choose Settings, then Browser.",
    "Press Add Browser.",
    platform === "mac"
      ? `Pick ${APP_NAME} in your Applications folder.`
      : `Pick ${APP_NAME} where it is installed.`,
  ];
}
