import { type BrowserTargetId } from "@instrument-org/workspace/electron";

// Tail after a guarded command acknowledges during which guest focus changes
// are still attributed to the agent: Chromium can deliver the focus transfer
// just after the CDP acknowledgement. It is also how long agent activity has
// to stay quiet before the host gets the caret back, so a click-then-type
// burst is treated as one stretch of agent work rather than two.
const COMMAND_TAIL_MS = 500;

// The subset whose focus transfer is incidental to what the agent asked for,
// and is therefore rejected on the user's behalf: a load that pulls focus out
// of whatever they were typing in is never what they wanted.
//
// `Input.*` is deliberately absent. Chromium delivers keyboard input to the
// widget holding keyboard focus rather than to the WebContents whose debugger
// carried the command, so a guest that does not hold focus cannot be typed
// into at all -- the keystrokes land in the host renderer instead. A CDP click
// focusing the element the agent is about to type into is that command working
// correctly, and bouncing it is what sends the next keystroke into the app's
// own UI. Guest focus taken this way is handed back once the agent goes quiet
// (see `armCommand`) instead of being refused up front.
export function bouncesGuestFocus(method: string): boolean {
  return (
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
  // Generation per target while any agent CDP command is active. A short tail
  // covers focus changes delivered just after the command acknowledgement.
  const commandGuards = new Map<BrowserTargetId, number>();
  // Generation per target while a command whose focus transfer we reject is
  // active. A subset of `commandGuards`, tracked separately so an ordinary
  // input command does not start rejecting focus the agent needs.
  const bounceGuards = new Map<BrowserTargetId, number>();
  // A load started by guarded automation can transfer guest focus after the
  // initiating CDP command has acknowledged, so retain host ownership until
  // that load settles.
  const navigationGuards = new Set<BrowserTargetId>();

  function isGuarded(targetId: BrowserTargetId) {
    return commandGuards.has(targetId) || navigationGuards.has(targetId);
  }

  function rejectsGuestFocus(targetId: BrowserTargetId) {
    return bounceGuards.has(targetId) || navigationGuards.has(targetId);
  }

  return {
    // Guard a command for its duration; returns a settle function for the
    // command's acknowledgement. `bounces` marks a command whose focus
    // transfer is rejected outright, which also restores host focus as soon as
    // it acknowledges. Every guarded command restores host focus once the
    // target has been quiet for the tail, so the caret returns after a burst
    // of agent input without interrupting the burst itself. `hostFocused`
    // seeds the claim synchronously; the renderer's focusin RPC (claimHost)
    // also updates it if the user moves into Studio after the command starts.
    armCommand(
      targetId: BrowserTargetId,
      hostFocused: boolean,
      bounces: boolean,
    ) {
      if (hostFocused) {
        hostFocusClaimed = true;
      }
      const generation = (commandGuards.get(targetId) ?? 0) + 1;
      commandGuards.set(targetId, generation);
      let bounceGeneration: number | undefined;
      if (bounces) {
        bounceGeneration = (bounceGuards.get(targetId) ?? 0) + 1;
        bounceGuards.set(targetId, bounceGeneration);
      }
      return () => {
        if (bounces && hostFocusClaimed) {
          restoreHostFocus(targetId);
        }
        setTimeout(() => {
          if (commandGuards.get(targetId) === generation) {
            commandGuards.delete(targetId);
          }
          if (
            bounceGeneration !== undefined &&
            bounceGuards.get(targetId) === bounceGeneration
          ) {
            bounceGuards.delete(targetId);
          }
          if (!isGuarded(targetId) && hostFocusClaimed) {
            restoreHostFocus(targetId);
          }
        }, COMMAND_TAIL_MS);
      };
    },
    // The renderer reported DOM focus on a guest's `<webview>`. While a
    // focus-rejecting command or its follow-on load owns the window, refuse it
    // and return true; the caller must then not record the guest as focused.
    bounceGuestFocus(targetId: BrowserTargetId): boolean {
      if (hostFocusClaimed && rejectsGuestFocus(targetId)) {
        restoreHostFocus(targetId);
        return true;
      }
      return false;
    },
    claimHost() {
      hostFocusClaimed = true;
    },
    forgetTarget(targetId: BrowserTargetId) {
      bounceGuards.delete(targetId);
      commandGuards.delete(targetId);
      navigationGuards.delete(targetId);
    },
    // Whether agent CDP activity (a command or its follow-on navigation, plus
    // the settle tail) currently owns this guest rather than the user. Lets
    // callers attribute a side effect -- e.g. a window.open -- to the agent vs.
    // the user, and keeps a guest focused by the agent's own click from being
    // recorded as the user taking over.
    isGuarded,
    // Guest WebContents gained Chromium focus. While a focus-rejecting command
    // holds this is the steal itself landing (possibly after a settle already
    // restored), so bounce it again.
    onGuestFocus(targetId: BrowserTargetId) {
      if (hostFocusClaimed && rejectsGuestFocus(targetId)) {
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
    // attribute the load (and any focus transfer it causes) to the agent. Any
    // agent command counts, including the click that followed a link, because
    // the load is what moves focus and the user did not ask for it either way.
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

// CDP methods that mean the agent, rather than the user, is currently driving
// a guest. Everything else the bridge relays (screenshots, Runtime.evaluate,
// accessibility reads, screencast frame acks) is pure observation, so counting
// those would leave a guest permanently agent-owned while a recording session
// acks frames at the capture rate.
export function isAgentDrivenCommand(method: string): boolean {
  return method.startsWith("Input.") || bouncesGuestFocus(method);
}
