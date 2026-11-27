import { z } from "zod";

/** The permissions an extension blocks or changes requests with. */
const BLOCKING_PERMISSIONS = [
  "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess",
  "webRequestBlocking",
];

/**
 * What an extension's manifest asks for that the in-app browser cannot give
 * it, in a person's words, so it is said before the extension is added and
 * on its row after, rather than found by it failing.
 *
 * - Requests: an extension's `webRequest` listeners and its
 *   `declarativeNetRequest` rules never run, because the guest session has
 *   listeners of its own and Electron then skips Chromium's extension
 *   request handling (docs/findings/extension-request-rules-never-run.md).
 * - Missing: neither Electron nor `electron-chrome-extensions` defines the
 *   API, so calling it throws; or nothing acts on the manifest key.
 *
 * Only what the manifest requires is read: an optional permission is asked
 * for later, if ever. `privacy` is left out on purpose: its stand-in answers
 * as if the setting changed, and the extensions that ask for it use it to
 * turn off the browser's own password saving, which this browser does not
 * have.
 */
const FEATURES: [feature: string, permissions: string[]][] = [
  ["Blocking content on pages", BLOCKING_PERMISSIONS],
  ["Seeing what pages load", ["webRequest"]],
  ["Side panel", ["sidePanel"]],
  // `getAuthToken`, which reads `oauth2`; `launchWebAuthFlow` works.
  ["Signing in through the browser", []],
  ["User scripts", ["userScripts"]],
  ["Tab groups", ["tabGroups"]],
  ["Recording tabs or the screen", ["tabCapture", "desktopCapture"]],
  ["Controlling pages as a developer tool", ["debugger"]],
  ["Saving pages", ["pageCapture"]],
  ["Bookmarks", ["bookmarks"]],
  ["Browsing history", ["history"]],
  ["Recently closed tabs", ["sessions"]],
  ["Most visited sites", ["topSites"]],
  ["Reading list", ["readingList"]],
  ["Web search", ["search"]],
  ["Address bar keywords", []],
  ["New tab page", []],
  ["Replacing browser pages", []],
  ["Default search engine", []],
  ["Clearing browsing data", ["browsingData"]],
  ["Site settings", ["contentSettings"]],
  ["Font settings", ["fontSettings"]],
  ["Reading text aloud", ["tts", "ttsEngine"]],
  ["Push messages", ["gcm"]],
  ["Printing", ["printerProvider"]],
];

const SupportManifestSchema = z.object({
  chrome_settings_overrides: z.unknown().optional(),
  chrome_url_overrides: z.record(z.string(), z.unknown()).catch({}),
  oauth2: z.unknown().optional(),
  omnibox: z.unknown().optional(),
  permissions: z
    .array(z.unknown())
    .transform((items) =>
      items.filter((item): item is string => typeof item === "string"),
    )
    .catch([]),
  side_panel: z.unknown().optional(),
});

/** The features of an extension that will not work in the in-app browser, most noticeable first; empty when all of it should. */
export function unsupportedFeatures(manifest: unknown): string[] {
  const parsed = SupportManifestSchema.catch({
    chrome_url_overrides: {},
    permissions: [],
  }).parse(manifest);
  const asked = new Set(parsed.permissions);
  const overrides = Object.keys(parsed.chrome_url_overrides);
  const byKey: Record<string, boolean> = {
    "Address bar keywords": parsed.omnibox !== undefined,
    "Default search engine": parsed.chrome_settings_overrides !== undefined,
    "New tab page": overrides.includes("newtab"),
    "Replacing browser pages": overrides.some((page) => page !== "newtab"),
    "Side panel": parsed.side_panel !== undefined,
    "Signing in through the browser": parsed.oauth2 !== undefined,
  };
  const blocks = BLOCKING_PERMISSIONS.some((permission) =>
    asked.has(permission),
  );
  return FEATURES.filter(([feature, permissions]) => {
    // An extension that blocks is told so once, not also that it watches.
    if (feature === "Seeing what pages load" && blocks) {
      return false;
    }
    return (
      byKey[feature] === true ||
      permissions.some((permission) => asked.has(permission))
    );
  }).map(([feature]) => feature);
}
