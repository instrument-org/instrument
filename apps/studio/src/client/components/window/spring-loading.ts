import { isInside } from "./host-path";

/** How long a drag rests on a folder before the folder opens under it. */
export const SPRING_DELAY_MS = 700;

/**
 * Whether a folder a drag is resting on opens under it: one not already open
 * on screen, that the drag is not carrying or carrying something around, that
 * the system has not refused, and whose first read raises no question from
 * the system in the middle of the drag.
 */
export function maySpring({
  asksFirst,
  carried,
  folder,
  hostPath,
  onScreen,
  refused,
}: {
  /** Whether reading the folder would have the system ask the person first. */
  asksFirst: boolean;
  /** What this app's own drag carries, by where each is on the computer. */
  carried: readonly string[];
  /** The folder, as a prefix under the root. */
  folder: string;
  /** Where the folder is on the computer. */
  hostPath: string;
  /** The folder the tab stands in, as a prefix under the root. */
  onScreen: string;
  refused: boolean;
}) {
  return (
    !onScreen.startsWith(folder) &&
    !asksFirst &&
    !refused &&
    !carried.some((each) => isInside(hostPath, each))
  );
}

/**
 * The wait before a folder springs open. `rest` is told the folder the drag
 * is over each time the drag is heard from, or null when it is over none that
 * may open; the wait starts over only when that changes, so moving about
 * inside one folder's row does not put it off. A folder that opened is not
 * opened again while the drag stays on it.
 */
export function springTimer(
  spring: (folder: string) => void,
  delay = SPRING_DELAY_MS,
) {
  let resting: null | string = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    rest(folder: null | string) {
      if (folder === resting) {
        return;
      }
      resting = folder;
      clearTimeout(timer);
      if (folder !== null) {
        timer = setTimeout(() => {
          spring(folder);
        }, delay);
      }
    },
    stop() {
      resting = null;
      clearTimeout(timer);
    },
  };
}
