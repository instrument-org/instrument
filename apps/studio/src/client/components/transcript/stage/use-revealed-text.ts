import { useCallback, useSyncExternalStore } from "react";

import { stage } from "./stage";

/**
 * A reply's text as far as the stage has revealed it, and whether more is on
 * its way out. The words that arrive while the reply is on screen come out at
 * the stage's pace; what was already there when it mounted shows at once.
 */
export function useRevealedText(
  id: string,
  text: string,
  isStreaming: boolean,
): { isRevealing: boolean; text: string } {
  // Pointed at the text during render, so the first paint already draws the
  // cut rather than the whole text and then the cut.
  stage.setTarget(id, text, isStreaming);
  const subscribe = useCallback(
    (listener: () => void) => stage.subscribeReveal(id, listener),
    [id],
  );
  const cut = useSyncExternalStore(subscribe, () => stage.cutOf(id));
  return {
    isRevealing: stage.isRevealing(id),
    text: cut === undefined ? text : text.slice(0, cut),
  };
}
