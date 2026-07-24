import { type BrowserTargetId } from "@instrument-org/workspace/electron";

// Tail after a guarded command acknowledges during which guest focus changes
// are still attributed to the agent: Chromium can deliver the focus transfer
// just after the CDP acknowledgement.
const COMMAND_TAIL_MS = 500;

// CDP methods that can move Chromium's keyboard focus into the guest: trusted
// input events and agent-driven navigations. Everything else the bridge
// relays (screenshots, Runtime.evaluate, accessibility reads, screencast
// frame acks) cannot steal focus -- page-level JS focus() does not cross
// processes -- so guarding those too would bounce the user's takeover click
// for as long as the agent merely observes the page (a recording session
// acks frames continuously at the capture rate) and publish a restore per
// acknowledged command.
export function canStealFocus(method: string): boolean {
  return (
    method.startsWith("Input.") ||
    method === "DOM.focus" ||
    method === "Page.bringToFront" ||
    method === "Page.navigate" ||
    method === "Page.navigateToHistoryEntry" ||
    method === "Page.reload"
  );
}

/**
 * Tracks when agent CDP activity, rather than the user, is driving a guest so
 * guest focus gained during that window can be bounced back to the host
 * renderer. Pure state machine: the caller supplies `restoreHostFocus` (which
 * applies its own window-focus check before publishing to the renderer) and
 * reports command/navigation/focus events into it.
 */
export function createFocusGuard({
  restoreHostFocus,
}: {
  restoreHostFocus: (targetId: BrowserTargetId) => void;
}) {
  // Whether the host renderer (Studio UI, not a guest) last claimed focus.
  // Unlike guest WebContents focus, this remains reliable when CDP input
  // crosses processes.
  let hostFocusClaimed = false;
  // Generation per target while an agent CDP command is active. A short tail
  // covers focus changes delivered just after the command acknowledgement.
  const commandGuards = new Map<BrowserTargetId, number>();
  // A load started by guarded automation can transfer guest focus after the
  // initiating CDP command has acknowledged, so retain host ownership until
  // that load settles.
  const navigationGuards = new Set<BrowserTargetId>();

  function isGuarded(targetId: BrowserTargetId) {
    return commandGuards.has(targetId) || navigationGuards.has(targetId);
  }

  return {
    // Guard a focus-capable command for its duration; returns a settle
    // function for the command's acknowledgement that restores host focus and
    // schedules the guard's tail expiry. `hostFocused` seeds the claim
    // synchronously; the renderer's focusin RPC (claimHost) also updates it
    // if the user moves into Studio after the command starts.
    armCommand(targetId: BrowserTargetId, hostFocused: boolean) {
      if (hostFocused) {
        hostFocusClaimed = true;
      }
      const generation = (commandGuards.get(targetId) ?? 0) + 1;
      commandGuards.set(targetId, generation);
      return () => {
        if (hostFocusClaimed) {
          restoreHostFocus(targetId);
        }
        setTimeout(() => {
          if (commandGuards.get(targetId) === generation) {
            commandGuards.delete(targetId);
          }
        }, COMMAND_TAIL_MS);
      };
    },
    // The renderer reported DOM focus on a guest's `<webview>`. While agent
    // activity owns the window, reject it and return true; the caller must
    // then not record the guest as user-focused.
    bounceGuestFocus(targetId: BrowserTargetId): boolean {
      if (hostFocusClaimed && isGuarded(targetId)) {
        restoreHostFocus(targetId);
        return true;
      }
      return false;
    },
    claimHost() {
      hostFocusClaimed = true;
    },
    forgetTarget(targetId: BrowserTargetId) {
      commandGuards.delete(targetId);
      navigationGuards.delete(targetId);
    },
    // Whether agent CDP activity (a command or its follow-on navigation, plus
    // the settle tail) currently owns this guest rather than the user. Lets
    // callers attribute a side effect -- e.g. a window.open -- to the agent vs.
    // the user.
    isGuarded,
    // Guest WebContents gained Chromium focus. During a guard this is the
    // steal itself landing (possibly after a settle already restored), so
    // bounce it again.
    onGuestFocus(targetId: BrowserTargetId) {
      if (hostFocusClaimed && isGuarded(targetId)) {
        restoreHostFocus(targetId);
      }
    },
    // A guarded load reached a paint/parse milestone; each is a chance the
    // focus transfer just landed, so re-restore while the guard holds.
    onLoadProgress(targetId: BrowserTargetId) {
      if (hostFocusClaimed && navigationGuards.has(targetId)) {
        restoreHostFocus(targetId);
      }
    },
    onLoadSettled(targetId: BrowserTargetId) {
      if (hostFocusClaimed && navigationGuards.has(targetId)) {
        restoreHostFocus(targetId);
      }
      navigationGuards.delete(targetId);
    },
    // A real main-frame navigation started while a command guard was active:
    // attribute the load (and any focus transfer it causes) to the agent.
    onNavigationStart(targetId: BrowserTargetId) {
      if (commandGuards.has(targetId)) {
        navigationGuards.add(targetId);
      }
    },
    releaseHost() {
      hostFocusClaimed = false;
    },
  };
}
