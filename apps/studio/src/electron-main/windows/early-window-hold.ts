import { app } from "electron";

/** What the hold asks of the early window, so a test can hand it a stand-in. */
type HeldWindow = {
  focus: () => void;
  isDestroyed: () => boolean;
  off: (event: "close", listener: (event: Electron.Event) => void) => unknown;
  on: (event: "close", listener: (event: Electron.Event) => void) => unknown;
};

/**
 * Holds back what would end the launch while its early window is up and the
 * rest of main still loads, until boot adopts the window and lets go (the
 * answer). Closing the window does nothing: outside macOS it would quit
 * before the workspace's quit is listening, and on macOS boot would bring
 * the window back anyway. A quit waits and goes ahead once boot lets go. A
 * second launch brings the window forward at once, when `canFocus` says it
 * is on screen.
 */
export function holdThroughBoot(
  window: HeldWindow,
  { canFocus }: { canFocus: () => boolean },
): () => void {
  let quitAsked = false;
  const holdClose = (event: Electron.Event) => {
    event.preventDefault();
  };
  const holdQuit = (event: Electron.Event) => {
    event.preventDefault();
    quitAsked = true;
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
    if (quitAsked) {
      // After boot's restore returns, which is what lets go.
      setImmediate(() => {
        app.quit();
      });
    }
  };
}
