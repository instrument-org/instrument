import { type TaskId } from "@instrument-org/workspace/client";

// Debounce before a freshly-opened task is marked read, so a quick flick past it
// (forward/back, arrowing the list) doesn't count as a read unless you linger.
// Only a fresh arrival is debounced; an indicator that appears while you're
// already sitting on the task clears at once so its dot never dwells on screen.
export const VIEW_CLEAR_DELAY_MS = 500;

interface TaskIndicatorViewState {
  // The task the hook is currently rendering.
  currentId: TaskId;
  // Whether the hook's tab is the foreground tab right now.
  isActiveTab: boolean;
  // Whether the unread indicator was set by hand ("mark as unread") vs. an
  // automatic completion mark.
  isManual: boolean;
  // Whether the task currently carries an unread indicator.
  isUnread: boolean;
  // The task id and foreground state observed on the previous render, `null`
  // before the first render.
  previousId: null | TaskId;
  wasActive: boolean | null;
}

// Decides whether a viewed task's unread indicator should clear, and after how
// long -- `null` means leave it. Kept pure (no React, no timers) because this
// branching is where the bugs lived; the surrounding hook is thin plumbing.
export function getTaskIndicatorClearDelay({
  currentId,
  isActiveTab,
  isManual,
  isUnread,
  previousId,
  wasActive,
}: TaskIndicatorViewState): null | number {
  // Only the foreground tab clears its own indicator, and only when unread.
  if (!isUnread || !isActiveTab) {
    return null;
  }

  // An arrival is the tab regaining the foreground OR navigating to a different
  // task within an already-foreground tab. Same-tab task switches reuse the hook
  // (one route component, `isActiveTab` staying true), so foreground state alone
  // can't see them -- the task id changing is what reveals them.
  const justArrived = wasActive !== true || previousId !== currentId;

  // A manual mark that appeared while we were already sitting on the task holds
  // until the user leaves and returns.
  if (isManual && !justArrived) {
    return null;
  }

  // Debounce only a fresh arrival; a mark that appears while we're already here
  // -- the task finished under our eyes -- clears immediately.
  return justArrived ? VIEW_CLEAR_DELAY_MS : 0;
}
