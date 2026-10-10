import { type AppUpdaterStatus } from "@/electron-main/lib/update-status";
import { type AppCommand } from "@/shared/app-command";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { EventPublisher } from "@orpc/server";

interface PublisherEvents {
  // How the Google sign-in to Instrument that came back through the browser
  // ended, for the sign-in waiting on it in the window.
  "auth.sign-in-outcome":
    | {
        error: {
          code?: string | undefined;
          message?: string | undefined;
          status: number;
          statusText: string;
        };
        outcome: Extract<SignInOutcome, "failed">;
      }
    | { outcome: Extract<SignInOutcome, "declined" | "signed-in"> };
  // The notices from us changed: a fetch brought new ones, or one was seen,
  // dismissed or toasted.
  "notices.updated": null;
  // The problems from earlier sessions waiting in the bell changed: one was
  // found at start, sent, or dismissed.
  "problems.updated": null;
  // The in-app browser's download list changed: a download began, moved
  // along, ended, or was taken off the list. The agent's own downloads report
  // through agent-browser instead and are not on it.
  "browser.downloads-changed": null;
  // Ask the renderer to put keyboard focus on a guest before agent keyboard
  // input is dispatched to it. Only renderer-side DOM focus on the `<webview>`
  // element moves Chromium's keyboard focus across the process boundary;
  // `webContents.focus()` on the guest does not.
  "browser.focus-guest": { targetId: BrowserTargetId };
  // A page in a tab an agent drives tried to go to a file outside the agent's
  // folders and was kept where it is. The app window says so,
  // since otherwise a link the person clicked just does nothing.
  "browser.navigation-refused": {
    targetId: BrowserTargetId;
  };
  // A person asked for a link on a page to open in a tab of its own: a
  // middle- or Cmd-click, a `target=_blank` link, or the page's menu. The
  // app window opens it in a tab of its own, behind
  // the one up when `background`.
  "browser.open-in-new-tab": {
    background: boolean;
    targetId: BrowserTargetId;
    url: string;
  };
  // Agent-driven browser input can move Chromium keyboard focus into a guest.
  // The renderer owns the exact Studio element that must be restored.
  "browser.restore-host-focus": null;
  // The size a target's parked guest should lay out at, or null to fall back to
  // the size the panel last showed it at. Only the renderer can resize a guest:
  // the `<webview>` element is its DOM.
  "browser.set-guest-surface": {
    size: null | { height: number; width: number };
    targetId: BrowserTargetId;
  };
  // A page's own menu asked to step back or forward. The window walks the
  // tab the page is in, the way its arrows and thumb buttons do, rather
  // than the guest stepping its own history alone.
  "browser.step-page": {
    direction: "back" | "forward";
    targetId: BrowserTargetId;
  };
  // Fired whenever the set of browser targets (entries) changes, so the
  // renderer pool can reconcile its `<webview>` guests to the desired set.
  "browser.targets-changed": null;
  // The ChatGPT account's sign-in state changed: signed in or out, a sign-in
  // started or ended, or a token was refreshed.
  "chatgpt-account.updated": null;
  // What the Claude Code CLI on this computer says about its sign-in changed.
  "claude-account.updated": null;
  "debug.browser-view-manager.updated": null;
  "features.updated": null;
  // Whether the platform API answers changed (development builds only).
  "platform-api.reachability.updated": null;
  "preferences.updated": null;
  "provider-config.updated": null;
  "server-exception": {
    message: string;
    stack?: string;
  };
  "server-exceptions.updated": null;
  "session.apiBearerToken.updated": null;
  "updates.status": { status: AppUpdaterStatus };
  "updates.trigger-check": null;
  // Asked of the app window by a swipe, a thumb button, a menu
  // chord, or a link from outside the app, all of which reach the main process
  // rather than the page: history either way, the close of the tab on screen,
  // the caret in the window's field, a screen to put up, or a file to open.
  // The chords that can mean a page (history, reload, find, zoom) come as they
  // were pressed, and the window decides which page, if any, they mean.
  "window.command":
    | "back"
    | "clearBrowsingData"
    | "closeTab"
    | "commandMenu"
    | "editPage"
    | "findInPage"
    | "forward"
    | "goToApps"
    | "goToBrowser"
    | "goToChat"
    | "goToFiles"
    | "newChat"
    | "newTab"
    | "nextChat"
    | "nextTab"
    | "openSettings"
    | "openShortcutGuide"
    | "reportProblem"
    | "previousChat"
    | "previousTab"
    | "reloadPage"
    | "reopenTab"
    | "search"
    | "toggleInbox"
    | "zoomIn"
    | "zoomOut"
    | "zoomReset"
    | { hostPath: string; type: "openFile" }
    | { href: string; type: "openScreen" }
    | { index: number; type: "selectTab" };
  // Something from outside was asked of the app window before it could take
  // it, and waits for it.
  "window.asks-waiting": null;
  "window.focus-changed": null;
  // A link under the pointer in text being edited, which the window's native
  // menu offers to open: the page that drew it opens it, in place or in a tab
  // of the window's own.
  "window.open-menu-link": { newTab: boolean };
  "window.state-changed": null;
}

// Per subscription, starting empty when it subscribes: what a subscriber that
// is still busy with one event holds of the ones after it. Several of these
// are commands to the renderer (a guest's surface, a tab to open, a finished
// download), which must each arrive, so they queue rather than leave only the
// newest. A live route re-reading state on them collapses a burst into one
// read (`liveRead`), so queuing costs it nothing.
export const publisher = new EventPublisher<PublisherEvents>({
  maxBufferedEvents: 100,
});

interface CommandEvents {
  // Imperative app commands from the main process's menus to the renderers.
  "app.command": AppCommand;
}

// Buffer a small burst of commands per subscriber. The buffer is per
// subscription and starts empty at subscribe time, so a reconnecting renderer
// can never replay commands from before it subscribed; the only real hazard is
// dropping a command published while the previous one's send is in flight
// (e.g. key-repeat Cmd+Plus), which a positive buffer preserves in order.
export const commandPublisher = new EventPublisher<CommandEvents>({
  maxBufferedEvents: 32,
});
