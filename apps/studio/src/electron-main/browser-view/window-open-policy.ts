import {
  type BrowserWindowConstructorOptions,
  type HandlerDetails,
  type WindowOpenHandlerResponse,
} from "electron";

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
// automation can't spawn a window the user never asked for.
export function guestWindowOpenHandler(
  details: HandlerDetails,
): WindowOpenHandlerResponse {
  if (details.disposition !== "new-window" || !isHttpUrl(details.url)) {
    return { action: "deny" };
  }
  return {
    action: "allow",
    overrideBrowserWindowOptions: popupWindowOptions(details.features),
  };
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
