import { BrowserWindow, type Session } from "electron";
import { type ElectronChromeExtensions } from "electron-chrome-extensions";
import { noop } from "radashi";
import { z } from "zod";

import { log } from "./log";

const WebAuthFlowSchema = z.object({
  abortOnLoadForNonInteractive: z.boolean().optional(),
  interactive: z.boolean().optional(),
  timeoutMsForNonInteractive: z.number().optional(),
  url: z.string(),
});

/**
 * Whether `url` is where a sign-in hands an extension its answer:
 * `https://<extension id>.chromiumapp.org/…`, which no server answers and
 * the flow's window catches before it loads.
 */
export function isAuthRedirect(url: string, extensionId: string): boolean {
  const parsed = URL.parse(url);
  return (
    parsed?.protocol === "https:" &&
    parsed.hostname === `${extensionId}.chromiumapp.org`
  );
}

/**
 * `chrome.identity.launchWebAuthFlow`: the provider's page in a window of
 * the in-app browser's session, so a site the person is signed in to there
 * answers at once, resolved with the address it sends the extension to.
 * The window shows only for an interactive flow, once the page loads
 * without sending the answer; a flow that is not interactive fails there
 * instead (unless it asked not to, and then at its timeout), and closing
 * the window refuses. `getAuthToken` and the rest of `chrome.identity` are
 * not answered: they hand out the browser's own Google account, which this
 * browser has none of.
 */
export function answerIdentityCalls(
  extensions: ElectronChromeExtensions,
  guestSession: Session,
  parentWindow: () => BrowserWindow | null,
): void {
  extensions.handleApiCall(
    "identity.launchWebAuthFlow",
    async ({ extension }, details) => {
      const asked = WebAuthFlowSchema.parse(details);
      const start = new URL(asked.url);
      if (start.protocol !== "https:" && start.protocol !== "http:") {
        throw new Error("Authorization page could not be loaded.");
      }
      const isInteractive = asked.interactive ?? false;
      log.info(
        `extension ${extension.id} web sign-in interactive=${String(isInteractive)} host=${start.host}`,
      );
      const parent = parentWindow();
      const window = new BrowserWindow({
        height: 680,
        ...(parent ? { parent } : {}),
        show: false,
        title: extension.name,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          session: guestSession,
        },
        width: 520,
      });
      return await new Promise<string>((resolve, reject) => {
        let isSettled = false;
        const settle = (outcome: { error: string } | { url: string }) => {
          if (isSettled) {
            return;
          }
          isSettled = true;
          clearTimeout(timer);
          if (!window.isDestroyed()) {
            window.destroy();
          }
          if ("url" in outcome) {
            resolve(outcome.url);
          } else {
            reject(new Error(outcome.error));
          }
        };
        const timer =
          !isInteractive && asked.timeoutMsForNonInteractive !== undefined
            ? setTimeout(() => {
                settle({ error: "User interaction required." });
              }, asked.timeoutMsForNonInteractive)
            : undefined;
        const catchAnswer = (event: {
          preventDefault: () => void;
          url: string;
        }) => {
          if (isAuthRedirect(event.url, extension.id)) {
            event.preventDefault();
            settle({ url: event.url });
          }
        };
        const contents = window.webContents;
        contents.on("will-redirect", catchAnswer);
        contents.on("will-navigate", catchAnswer);
        contents.on("did-finish-load", () => {
          if (isSettled) {
            return;
          }
          if (isInteractive) {
            window.show();
          } else if (asked.abortOnLoadForNonInteractive ?? true) {
            settle({ error: "User interaction required." });
          }
        });
        contents.on(
          "did-fail-load",
          (_event, _code, _description, _url, isMainFrame) => {
            if (isMainFrame) {
              settle({ error: "Authorization page could not be loaded." });
            }
          },
        );
        window.on("closed", () => {
          settle({ error: "The user did not approve access." });
        });
        // Aborted when the answer is caught, which settled it already.
        contents.loadURL(start.href).catch(noop);
      });
    },
    { permission: "identity" },
  );
}
