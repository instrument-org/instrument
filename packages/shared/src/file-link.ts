import { APP_NAME_SLUG, APP_PROTOCOL } from "./constants";

/**
 * The scheme the app answers to. The build's own protocol is what the OS
 * hands over, and the released app's is what a reply writes: a link the
 * agent wrote in a development build reads the same as one in a release.
 */
const SCHEMES = new Set([`${APP_NAME_SLUG}:`, `${APP_PROTOCOL}:`]);

/**
 * The file path an `instrument://file/<path>` address names, or undefined for
 * any other address. A file is handed over as a path, not as a place in the
 * window, but a reply taught to link tasks and chats this way reaches for
 * the same form for a file, and the path in it is the one it meant. The one
 * reading of such a link, for the window that opens it and the check that
 * tells the agent it named nothing.
 */
export function filePathOfInstrumentLink(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (!SCHEMES.has(parsed.protocol) || parsed.host.toLowerCase() !== "file") {
    return undefined;
  }
  // `instrument://file//Users/sam/a.md` and `instrument://file/Users/sam/a.md` both mean
  // the absolute path the reply had in hand.
  const path = decoded(parsed.pathname).replace(/^\/+/, "/");
  return path === "/" ? undefined : path;
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
