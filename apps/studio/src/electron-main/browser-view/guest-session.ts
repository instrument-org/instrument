import { getBrowserSessionDir } from "@instrument-org/workspace/electron";
import { BrowserWindow, session, type Session } from "electron";
import fs from "node:fs";
import path from "node:path";

import { applyStandardUserAgent } from "../lib/user-agent";
import { followPageEdits } from "../page-editor/sessions";
import {
  blockedRequestResponse,
  cspResponse,
  enableContentBlocking,
} from "./content-blocking";
import { routeGuestDownloads } from "./downloads";
import { mayOpenInAnotherApp } from "./external-app-links";
import { askToOpenInAnotherApp } from "./external-app-prompt";
import { enableBrowserExtensions, registerExtensionWindow } from "./extensions";
import { mayEnterFullScreen } from "./full-screen-policy";
import { attachGuestInteractions } from "./guest-interactions";
import { guests } from "./guest-registry";
import { log } from "./log";
import { mayCaptureMedia } from "./media-capture-policy";
import {
  grantedTo,
  listenForPageCapture,
  noteGranted,
  noteRefused,
  noteSystemRefused,
  originOf,
  systemRefusal,
} from "./page-capture";
import { refusePasskeys } from "./passkey-policy";
import {
  confineLocalPagesToTheirFolder,
  refuseLocalFilesIn,
} from "./local-file-policy";
import { guestWindowOpenHandler, isHttpUrl } from "./window-open-policy";

let configured: null | { dir: string; session: Session } = null;

/**
 * The workspace's browser session, which every task guest and every window a
 * guest's page opens runs in, set up the first time it is asked for and
 * handed back as it is after that. Everything the session does for a page is
 * registered here, once: the guest registry that tells its contents apart,
 * the permission policy, the user agent, the local-file rule and ad blocking
 * (one request listener between them), ad blocking's CSP filters and the
 * passkey refusal (one headers listener between them), downloads, and the
 * page editor.
 *
 * A process opens one workspace, so it has one browser profile; a second
 * folder asked for would be a second profile, which nothing here expects.
 */
export function configureGuestSession(profileDir: string): Session {
  if (configured) {
    if (configured.dir !== profileDir) {
      throw new Error(
        `The browser session is already open at ${configured.dir}, not ${profileDir}`,
      );
    }
    return configured.session;
  }
  // session.fromPath requires the directory to exist (Chromium opens the
  // profile in place), and the workspace's .instrument dir is made lazily.
  fs.mkdirSync(profileDir, { recursive: true });
  const guestSession = session.fromPath(profileDir, { cache: true });
  configured = { dir: profileDir, session: guestSession };

  // Before any contents exists in the session, so each one has a record from
  // its first navigation on. Every window in the session but a tab's guest is
  // one a guest's page opened: it keeps the open policy for the windows it
  // opens in turn, and never shows a file.
  guests.watchSession(
    guestSession,
    (contents) => (contents.getType() === "webview" ? "webview" : "popup"),
    (record) => {
      record.contents.on("did-create-window", (window) => {
        registerExtensionWindow(window);
      });
      if (record.role === "popup") {
        record.contents.setWindowOpenHandler(guestWindowOpenHandler);
        refuseLocalFilesIn(record.contents);
        // The menu a tab's page has, for the popup itself: it has no tab to
        // open a link in, and steps through its own history.
        attachGuestInteractions(record.contents, {
          mayOpen: isHttpUrl,
          step: (direction) => {
            const history = record.contents.navigationHistory;
            if (direction === "back") {
              history.goBack();
            } else {
              history.goForward();
            }
          },
        });
      } else {
        followPageEdits(record.contents);
      }
    },
  );

  // Electron auto-approves every permission request (camera, mic,
  // geolocation, notifications, ...) when no handler is set. There's no
  // browser chrome here to show a native prompt, so deny everything rather
  // than silently granting it to whatever site the guest navigates to. The
  // one exception is writing text to the clipboard, which ordinary browsers
  // grant without a prompt and which a page's copy button needs:
  // `navigator.clipboard.writeText` rejects under a denial, and most pages
  // swallow that rejection, so the button does nothing. Reading the clipboard
  // stays denied; a page overwriting it is a click the user made, a page
  // reading it is the user's clipboard handed over. Full screen goes only to
  // a tab a person is looking at and just used (`mayEnterFullScreen`): it
  // takes the whole window into full screen, onto a Space of its own on
  // macOS, and Chromium counts an agent's CDP click as the user gesture it
  // asks for. A page already in full screen may always ask again. Once it is
  // granted, Esc leaves it, and Electron puts the window in full screen and
  // stands the guest over all of it, then puts both back; on macOS the
  // window's pages are told again once its exit animation ends
  // (`full-screen-exit.ts`). A page no slot is showing is still taken back
  // out (`leaveFullScreen` in `browser-pool.ts`). A link to another app (`slack://`) goes to that app
  // when a person just used the tab and says yes, or said its site always
  // may. The microphone and camera go to a tab a person is looking at and
  // just clicked in (`mayCaptureMedia`), once the system allows the app them
  // too, and then to that page's origin in that tab again while it is shown.
  guestSession.setPermissionRequestHandler(
    (wc, permission, callback, details) => {
      if (permission === "media") {
        const origin = originOf(
          "securityOrigin" in details ? details.securityOrigin : undefined,
        );
        const mediaTypes =
          "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
        const record = guests.get(wc.id);
        const host = wc.hostWebContents;
        const asked = {
          grantedBefore: grantedTo(wc, origin),
          record,
          shown: record?.entry?.shown ?? false,
          windowFocused:
            !!host &&
            !host.isDestroyed() &&
            !!BrowserWindow.fromWebContents(host)?.isFocused(),
        };
        const allowed = !!origin && mayCaptureMedia(asked);
        log.info(
          `media ${allowed ? "allowed" : "refused"} guest=${wc.id} types=${mediaTypes.join("+") || "none"} origin=${origin || "none"} grantedBefore=${String(asked.grantedBefore)} shown=${String(asked.shown)} windowFocused=${String(asked.windowFocused)} inputAgoMs=${record?.userInputAt ? Date.now() - record.userInputAt : "never"}`,
        );
        if (!allowed) {
          // A tab's page, which the person can allow from its omnibar; a
          // popup has none.
          if (record?.role === "webview") {
            noteRefused(wc, origin, mediaTypes);
          }
          callback(false);
          return;
        }
        systemRefusal(mediaTypes).then(
          (refused) => {
            log.info(`media system=${refused ?? "allowed"} guest=${wc.id}`);
            if (!wc.isDestroyed()) {
              if (refused) {
                noteSystemRefused(wc, refused);
              } else {
                noteGranted(wc, origin);
              }
            }
            callback(!refused);
          },
          () => {
            callback(false);
          },
        );
        return;
      }
      if (permission === "fullscreen") {
        const record = guests.get(wc.id);
        const host = wc.hostWebContents;
        const asked = {
          record,
          shown: record?.entry?.shown ?? false,
          windowFocused:
            !!host &&
            !host.isDestroyed() &&
            !!BrowserWindow.fromWebContents(host)?.isFocused(),
        };
        const allowed = mayEnterFullScreen(asked);
        log.info(
          `full screen ${allowed ? "granted" : "refused"} guest=${wc.id} role=${record?.role ?? "none"} inFullScreen=${String(record?.htmlFullScreen ?? false)} shown=${String(asked.shown)} windowFocused=${String(asked.windowFocused)} inputAgoMs=${record?.userInputAt ? Date.now() - record.userInputAt : "never"}`,
        );
        callback(allowed);
        return;
      }
      if (permission !== "openExternal") {
        callback(permission === "clipboard-sanitized-write");
        return;
      }
      if (!mayOpenInAnotherApp(guests.get(wc.id))) {
        callback(false);
        return;
      }
      const externalURL =
        "externalURL" in details ? (details.externalURL ?? "") : "";
      askToOpenInAnotherApp(wc, externalURL, details.requestingUrl).then(
        callback,
        () => {
          callback(false);
        },
      );
    },
  );
  // A page granted the microphone or camera in a tab sees them as granted
  // there (device names included) until the tab leaves for another origin.
  guestSession.setPermissionCheckHandler(
    (wc, permission, requestingOrigin) =>
      permission === "clipboard-sanitized-write" ||
      (permission === "media" &&
        !!wc &&
        grantedTo(wc, originOf(requestingOrigin))),
  );
  // Normalize the guest's User-Agent to the shape an ordinary Chromium-derived
  // browser ships (and matching client hints) so third-party services treat it
  // like one. Branded with the app's own name because the guest's pages get the
  // matching metadata over CDP; see applyProductBrandedMetadata.
  applyStandardUserAgent(guestSession, { productBranded: true });
  confineLocalPagesToTheirFolder(guestSession, blockedRequestResponse);
  enableContentBlocking(guestSession, (id) => guests.isAdBlockExempt(id));
  refusePasskeys(guestSession, cspResponse);
  routeGuestDownloads(guestSession, guests);
  enableBrowserExtensions(guestSession, extensionsDirOf(profileDir));
  listenForPageCapture();
  return guestSession;
}

/**
 * Turns the extensions on at launch, opening the browser's session if no
 * page has yet, so the window's buttons find them up rather than asking
 * before anything answers.
 */
export function startBrowserExtensions(): void {
  const profileDir = getBrowserSessionDir();
  enableBrowserExtensions(
    configureGuestSession(profileDir),
    extensionsDirOf(profileDir),
  );
}

/** Where the store keeps what it installs: beside the profile, not in it. */
function extensionsDirOf(profileDir: string): string {
  return path.join(path.dirname(profileDir), "extensions");
}
