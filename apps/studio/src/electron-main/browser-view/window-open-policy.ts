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
// and JS tab-opens report `foreground-tab`/`background-tab` and stay denied.
// The caller additionally denies opens while agent CDP activity is driving the
// guest, so automation can't spawn a window the user never asked for.
export function guestWindowOpenHandler(
  details: HandlerDetails,
): WindowOpenHandlerResponse {
  if (details.disposition !== "new-window") {
    return { action: "deny" };
  }
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return { action: "deny" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { action: "deny" };
  }
  return {
    action: "allow",
    overrideBrowserWindowOptions: popupWindowOptions(details.features),
  };
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
