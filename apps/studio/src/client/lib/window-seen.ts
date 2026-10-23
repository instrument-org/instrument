/**
 * Whether the person is looking at this window: it is shown and has focus. A
 * window left open on another display while they work elsewhere is not seen,
 * so what says something changed there waits for them to come back. Each
 * window answers for itself, from its own document.
 */
function isWindowSeen() {
  return document.visibilityState === "visible" && document.hasFocus();
}

const waiting = new Set<() => void>();
let listening = false;

function runWaiting() {
  if (!isWindowSeen()) {
    return;
  }
  const due = [...waiting];
  waiting.clear();
  for (const run of due) {
    run();
  }
}

/**
 * Runs `run` now if the window is seen, otherwise once it next is. Returns
 * the way to stop it from running.
 */
export function whenWindowSeen(run: () => void) {
  if (isWindowSeen()) {
    run();
    return () => {};
  }
  if (!listening) {
    listening = true;
    window.addEventListener("focus", runWaiting);
    // Focus going straight into a browser guest from another app reaches the
    // document as a focusin on its element.
    document.addEventListener("focusin", runWaiting);
    document.addEventListener("visibilitychange", runWaiting);
  }
  waiting.add(run);
  return () => {
    waiting.delete(run);
  };
}
