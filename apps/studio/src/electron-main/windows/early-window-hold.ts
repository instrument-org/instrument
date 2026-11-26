import { app } from "electron";

/** What the hold asks of the early window, so a test can hand it a stand-in. */
type HeldWindow = {
  focus: () => void;
  isDestroyed: () => boolean;
  off: (event: "close", listener: (event: Electron.Event) => void) => unknown;
  on: (event: "close", listener: (event: Electron.Event) => void) => unknown;
};

/**
 * How long a quit waits on boot before it goes ahead anyway, for a boot
 * stalled on something slow to arrive, such as a folder still downloading.
 */
const QUIT_WAIT_MS = 10_000;

/**
 * Holds back what would end the launch while its early window is up and the
 * rest of main still loads, until boot adopts the window and lets go (the
 * answer). A quit waits and goes ahead once boot lets go, or at once when
 * asked again, or after `QUIT_WAIT_MS`. Closing the window waits too: on
 * macOS boot would bring the window back anyway, and elsewhere, where
 * closing it is how the app is quit, it counts as asking to quit. Once a
 * quit is asked, a close goes ahead. A second launch brings the window
 * forward at once, when `canFocus` says it is on screen.
 */
export function holdThroughBoot(
  window: HeldWindow,
  {
    canFocus,
    isMac = process.platform === "darwin",
  }: { canFocus: () => boolean; isMac?: boolean },
): () => void {
  let quitAsked = false;
  let quitWait: ReturnType<typeof setTimeout> | undefined;
  const askQuit = () => {
    quitAsked = true;
    quitWait = setTimeout(() => {
      app.quit();
    }, QUIT_WAIT_MS);
  };
  const holdClose = (event: Electron.Event) => {
    if (quitAsked) {
      return;
    }
    event.preventDefault();
    if (!isMac) {
      askQuit();
    }
  };
  const holdQuit = (event: Electron.Event) => {
    if (quitAsked) {
      return;
    }
    event.preventDefault();
    askQuit();
  };
  const comeForward = () => {
    if (!window.isDestroyed() && canFocus()) {
      window.focus();
    }
  };
  window.on("close", holdClose);
  app.on("before-quit", holdQuit);
  app.on("second-instance", comeForward);
  return () => {
    window.off("close", holdClose);
    app.off("before-quit", holdQuit);
    app.off("second-instance", comeForward);
    clearTimeout(quitWait);
    if (quitAsked) {
      // After boot's restore returns, which is what lets go.
      setImmediate(() => {
        app.quit();
      });
    }
  };
}
