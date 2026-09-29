import { inboxOpenAtom } from "@/client/atoms/orchestrator";
import { atom, useAtom } from "jotai";
import { useEffect } from "react";

/** Whether the inbox was put away for a row too narrow for it, rather than by hand. */
const inboxSteppedAsideAtom = atom(false);
/** Whether the row was too narrow for the inbox when the tab up last answered to it, so a crossing is told from a row that stayed put. */
const inboxAnsweredCrowdedAtom = atom(false);

/**
 * Whether the chat's inbox is on screen, given the room its row leaves it.
 *
 * The inbox steps aside as the row crosses into too narrow, and comes back as
 * it crosses out, unless someone put it away or brought it back in between.
 * Only the crossing acts, so either choice holds at any width. Whether the
 * inbox stepped aside is the window's, like the inbox itself, and only the tab
 * up acts on either: a tab behind has no row to be crowded in.
 *
 * A crossing shows in the render that finds it rather than a frame after, so a
 * chat arrived at in a narrow window paints with the inbox already aside, and
 * one arrived at after widening paints with it already back. Whatever the row
 * does happens at once, which `isCrossing` says: a slide in the middle of a
 * window being resized drags what is beside the inbox sideways under the
 * pointer, and on arrival there is nothing yet to slide from.
 */
export function useInboxRoom({
  isActive,
  margin,
  needs,
  room,
}: {
  isActive: boolean;
  /** How much past `needs` the row must reach before an inbox that stepped aside comes back. */
  margin: number;
  /** The width what is beside the inbox needs. */
  needs: number;
  /** The width the row leaves beside the inbox, or undefined when nothing is beside it or the row is not measured yet. */
  room: number | undefined;
}) {
  const [isInboxOpen, setInboxOpen] = useAtom(inboxOpenAtom);
  const [isSteppedAside, setSteppedAside] = useAtom(inboxSteppedAsideAtom);
  const [answeredCrowded, setAnsweredCrowded] = useAtom(
    inboxAnsweredCrowdedAtom,
  );
  const isCrowded =
    room !== undefined && room < needs + (isSteppedAside ? margin : 0);
  const isCrossing = isActive && isCrowded !== answeredCrowded;
  const isShown = isCrossing
    ? !isCrowded && (isInboxOpen || isSteppedAside)
    : isInboxOpen;

  useEffect(() => {
    if (!isCrossing) {
      return;
    }
    setAnsweredCrowded(isCrowded);
    if (isCrowded) {
      if (isInboxOpen) {
        setSteppedAside(true);
        setInboxOpen(false);
      }
      return;
    }
    if (isSteppedAside && !isInboxOpen) {
      setInboxOpen(true);
    }
    setSteppedAside(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrossing]);
  // Brought back by hand, the inbox is someone's choice from then on. Not
  // while the row is crossing: the inbox this render read as open is the one
  // the crossing is putting aside.
  useEffect(() => {
    if (isInboxOpen && !isCrossing) {
      setSteppedAside(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInboxOpen]);

  return { isCrossing, isShown, isSteppedAside };
}
