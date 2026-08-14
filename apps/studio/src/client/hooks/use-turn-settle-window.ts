import { useEffect, useState } from "react";

// How long the window stays open after the session reports itself idle. Long
// enough for the frames a turn's last content takes to land, short enough that
// a transcript nothing is arriving into is the reader's again well before they
// reach for anything in it.
const TURN_SETTLE_WINDOW_MS = 1000;

/**
 * Whether the turn that just ended is still settling.
 *
 * A turn's last content lands after the session says it has stopped, not
 * before: a ```files fence draws its final card only once the message stops
 * streaming, a diagram renders when its bundle arrives, and the session's
 * status and the transcript's messages come from two live queries that can
 * commit on the same frame. Anything that follows the transcript therefore has
 * to outlast the status by a moment, or the end of a turn lands below the fold.
 *
 * Opens on alive → idle and closes on the timer or on the next turn starting,
 * whichever comes first.
 */
export function useTurnSettleWindow(isAgentAlive: boolean) {
  const [isSettling, setIsSettling] = useState(false);
  const [wasAgentAlive, setWasAgentAlive] = useState(isAgentAlive);

  if (wasAgentAlive !== isAgentAlive) {
    setWasAgentAlive(isAgentAlive);
    setIsSettling(!isAgentAlive);
  }

  useEffect(() => {
    if (!isSettling) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsSettling(false);
    }, TURN_SETTLE_WINDOW_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isSettling]);

  return isSettling;
}
