import { filePathOfInstrumentLink } from "@instrument-org/shared";
import {
  type BrowserWindowConstructorOptions,
  type HandlerDetails,
  type WindowOpenHandlerResponse,
} from "electron";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fromHome } from "@/electron-main/lib/link-home";

// window.open shape policy for the browser guests. Sign-in popups ("Continue
// with Google" and friends) call window.open(url, name, "width=...,height=...")
// and finish by posting their result back to the opener; Chromium reports these
// as `new-window`. Denying them -- window.open then returns null with no window
// -- is what leaves such flows hanging, so allow real popups to http(s) URLs
// (opened as a child window that inherits the guest's locked-down,
// same-partition session, preserving the opener channel). target=_blank links
// and tab-opens report `foreground-tab`/`background-tab` and get no window;
// `sameTabNavigationUrl` is what keeps those from being dead clicks. The caller
// additionally denies opens while agent CDP activity is driving the guest, so
// automation can't spawn a window the user never asked for; such a popup
// becomes a tab of the chat instead (`agentPopupTabOf`).
export function guestWindowOpenHandler(
  details: HandlerDetails,
): WindowOpenHandlerResponse {
  if (
    details.disposition !== "new-window" ||
    isWindowAsk(details) ||
    !isHttpUrl(details.url)
  ) {
    return { action: "deny" };
  }
  return {
    action: "allow",
    overrideBrowserWindowOptions: popupWindowOptions(details.features),
  };
}

// Where a popup a page opens while an agent drives it goes instead: a tab of
// the chat at the popup's address, behind whatever is up, which every session
// of the chat can drive. A window is no use there (no debugger reaches it, it
// is in no chat), and a `<webview>` cannot be given the opener, so a sign-in
// popup that answers its opener does not finish this way; the person's own
// click still gets the real window. Null for anything but a popup to the web.
export function agentPopupTabOf(details: HandlerDetails): null | string {
  return details.disposition === "new-window" &&
    !isWindowAsk(details) &&
    isHttpUrl(details.url)
    ? details.url
    : null;
}

export function isFileUrl(value: string): boolean {
  return value.startsWith("file:");
}

/**
 * The address a page's link is followed at in the browser: a link to a file
 * in the app's own scheme (`instrument://file/~/notes/a.html`) as the
 * `file://` address of the file it names, so a tab-open, a Shift-click and
 * the context menu treat it as the page's link to that file. Any other
 * address, and a path that is not absolute once `~` is read as home, as it
 * is.
 */
export function pageAddressOfLink(
  url: string,
  home = os.homedir(),
  hostPaths: path.PlatformPath = path,
): string {
  const linkPath = filePathOfInstrumentLink(url);
  if (linkPath === undefined) {
    return url;
  }
  const spelled = fromHome(linkPath, home, hostPaths);
  // The leading slash the link form puts in front of a drive letter.
  const hostPath = /^\/[A-Z]:\//i.test(spelled) ? spelled.slice(1) : spelled;
  return hostPaths.isAbsolute(hostPath)
    ? pathToFileURL(hostPaths.resolve(hostPath), {
        windows: hostPaths.sep === "\\",
      }).href
    : url;
}

// The one protocol test for anything the guest may be sent to by a link: an
// open the policy allows, an open it turns into a same-tab navigation, and the
// context menu's own "Open Link".
export function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

// Where a tab-open should open in a tab of the window's own, for a window
// that has tabs: a `target=_blank` link (`foreground-tab`) or a middle- or
// Cmd-click (`background-tab`), to the web or, from a page on the computer,
// to another file on it. A web page cannot reach a file, so a file address
// from one is no tab. Null for every other open.
export function newTabOpenOf(
  details: HandlerDetails,
  fromUrl: string | undefined,
): null | { background: boolean; url: string } {
  const opensATab =
    details.disposition === "foreground-tab" ||
    details.disposition === "background-tab";
  const reachable =
    isHttpUrl(details.url) ||
    (isFileUrl(details.url) && fromUrl !== undefined && isFileUrl(fromUrl));
  if (!opensATab || !reachable) {
    return null;
  }
  return {
    background: details.disposition === "background-tab",
    url: details.url,
  };
}

// A Shift-click on a link, which a browser built on Chromium opens in a window
// of its own. Chromium reports it as `new-window`, as it does a popup, but a
// page's popup always names features (a size, `popup`), and `window.open` with
// none is a tab, so `new-window` with no features and no name is only ever
// the person's Shift-click.
function isWindowAsk(details: HandlerDetails) {
  return (
    details.disposition === "new-window" &&
    details.features.trim() === "" &&
    details.frameName === ""
  );
}

// Where a Shift-click should open in a window of the app's own: to the web
// or, from a page on the computer, to another file on it, as a tab-open
// would. Null for every other open.
export function newWindowOpenOf(
  details: HandlerDetails,
  fromUrl: string | undefined,
): null | { url: string } {
  const reachable =
    isHttpUrl(details.url) ||
    (isFileUrl(details.url) && fromUrl !== undefined && isFileUrl(fromUrl));
  return isWindowAsk(details) && reachable ? { url: details.url } : null;
}

// Where a denied open should navigate the guest that asked for it, or null to
// let the denial stand. A denied tab-open is otherwise invisible: the handler
// runs before Chromium mints a WebContents, so nothing opens, the current page
// does not move, and the user gets no signal at all -- on a site that uses
// _blank for its primary links (Amazon's cart titles, say) the browser reads as
// broken. A guest holds one page, so the honest reading of "open this somewhere
// else" is "open it here". Both tab dispositions: `foreground-tab` is a
// target=_blank link, `background-tab` is cmd- or middle-click, and until a
// guest can hold more than one page the only alternative to landing them here
// is dropping them.
export function sameTabNavigationUrl(details: HandlerDetails): null | string {
  const opensATab =
    details.disposition === "foreground-tab" ||
    details.disposition === "background-tab";
  if (!opensATab || !isHttpUrl(details.url)) {
    return null;
  }
  return details.url;
}

function clampPopupDimension(value: null | string, fallback: number): number {
  const parsed = value == null ? Number.NaN : Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 240), 1600);
}

// Size the sign-in popup from the window.open features (clamped), falling back
// to a typical OAuth popup size, and hide the menu bar so it reads as a
// chromeless auth window.
function popupWindowOptions(features: string): BrowserWindowConstructorOptions {
  const parsed = new URLSearchParams(features.replaceAll(",", "&"));
  return {
    autoHideMenuBar: true,
    height: clampPopupDimension(parsed.get("height"), 720),
    width: clampPopupDimension(parsed.get("width"), 520),
  };
}
