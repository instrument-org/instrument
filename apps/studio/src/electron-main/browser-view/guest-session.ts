import { session, type Session } from "electron";
import fs from "node:fs";

import { applyStandardUserAgent } from "../lib/user-agent";
import { followPageEdits } from "../page-editor/sessions";
import {
  blockedRequestResponse,
  cspResponse,
  enableContentBlocking,
} from "./content-blocking";
import { routeGuestDownloads } from "./downloads";
import { guests } from "./guest-registry";
import { refusePasskeys } from "./passkey-policy";
import {
  confineLocalPagesToTheirFolder,
  refuseLocalFilesIn,
} from "./local-file-policy";
import { guestWindowOpenHandler } from "./window-open-policy";

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
      if (record.role === "popup") {
        record.contents.setWindowOpenHandler(guestWindowOpenHandler);
        refuseLocalFilesIn(record.contents);
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
  // reading it is the user's clipboard handed over.
  guestSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
  guestSession.setPermissionCheckHandler(
    (_wc, permission) => permission === "clipboard-sanitized-write",
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
  return guestSession;
}
