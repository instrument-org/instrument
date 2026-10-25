/**
 * What something outside the window asks it to put up: a screen by its
 * route, from a link, a file handed to the app, which the window places
 * itself, or a new chat's draft with the words a link brought.
 */
export type AppWindowAsk =
  | { hostPath: string; type: "openFile" }
  | { href: string; type: "openScreen" }
  | { topic?: string; type: "newChat"; words: string };

/**
 * Where asks from outside the window wait until it can take them: while its
 * page is loading, which cannot hear the command stream yet, and while
 * `isHeld` says the window is not the person's to use (setup is up). They go
 * out in order, through `deliver`, once both are past: the page asks for what
 * waited when it is up (`take`), and `release` sends what waited when the
 * hold lifts.
 */
export function createAppWindowAsks({
  deliver,
  isHeld,
}: {
  deliver: (ask: AppWindowAsk) => void;
  isHeld: () => boolean;
}) {
  let pending: AppWindowAsk[] = [];
  // Whether the window's page has taken what waited for it, and so is
  // listening for asks as they come. A window that exists is not enough: its
  // page may still be loading, or reloading.
  let isTaking = false;

  const handOver = () => {
    const asks = pending;
    pending = [];
    return asks;
  };

  return {
    ask(ask: AppWindowAsk) {
      if (isTaking && !isHeld()) {
        deliver(ask);
        return;
      }
      pending.push(ask);
    },
    /** The window lifted its hold: what waited goes to a page listening. */
    release() {
      if (!isTaking || isHeld()) {
        return;
      }
      for (const ask of handOver()) {
        deliver(ask);
      }
    },
    /** The page went away or is loading afresh, and is not listening. */
    stopTaking() {
      isTaking = false;
    },
    /** The page is up and listening: what waited for it, unless held. */
    take(): AppWindowAsk[] {
      isTaking = true;
      return isHeld() ? [] : handOver();
    },
    /** What waits, which a link from outside is let go past a few of. */
    get waiting(): readonly AppWindowAsk[] {
      return pending;
    },
  };
}
