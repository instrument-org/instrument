// A single user-initiated quit reaches the confirmation more than once: outside
// macOS the window close asks first, then the destroyed window triggers
// `window-all-closed` -> `app.quit()` -> `before-quit`. The approval is latched
// (and de-duplicated while in flight) so the user is asked exactly once.

type QuitApproval = () => Promise<boolean>;

let approval: QuitApproval = () => Promise.resolve(true);
let isApproved = false;
let pending: null | Promise<boolean> = null;

export function isQuitApproved() {
  return isApproved;
}

/** True once the user has approved this quit; no further prompt is needed. */
export async function requestQuitApproval(): Promise<boolean> {
  if (isApproved) {
    return true;
  }
  pending ??= runApproval();
  return pending;
}

/**
 * Register the prompt that guards a quit. Called once during boot, before any
 * window exists, so every close/quit path can reach it.
 */
export function setQuitApproval(quitApproval: QuitApproval) {
  approval = quitApproval;
}

async function runApproval() {
  try {
    isApproved = await approval();
  } catch {
    // Fail open, matching the running-agent count: a prompt that can't be
    // answered must not strand the quit half-done, which outside macOS can mean
    // a live process with no window left to return to.
    isApproved = true;
  } finally {
    pending = null;
  }
  return isApproved;
}
