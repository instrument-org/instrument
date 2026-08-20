import { type TaskId } from "@instrument-org/workspace/client";
import { useState } from "react";

/**
 * The name the reader last gave a task themselves, keyed by task.
 *
 * Held trimmed, which is the form the name comes back in: the update schema
 * trims it on the way to disk, so an untrimmed record would never match what
 * the live query then delivers.
 *
 * One name per task -- the most recent -- so this is at most the list of tasks
 * renamed by hand this session, and never evicts. A rename made anywhere in the
 * app is recorded for everywhere, which is the point: renaming from the task
 * header must not set the sidebar's copy of the same title alight.
 */
const titlesRenamedByUser = new Map<TaskId, string>();

/**
 * Record that this name is the reader's own, so the arrival it causes is not
 * animated. Call it wherever a rename is sent, before the write.
 */
export function markTitleRenamedByUser(id: TaskId, title: string): void {
  titlesRenamedByUser.set(id, title.trim());
}

/**
 * The wash a task's name arrives under when it changes to one the reader did
 * not type.
 *
 * A task is named from its first message a moment after it is opened, so the
 * name under the reader's eye is replaced while they are reading it. Swapped
 * outright it reads as a glitch -- two different words in the same place, with
 * nothing to say which came first. Swept in left to right, the same moment
 * reads as the task being named, which is what happened.
 *
 * Nothing the reader typed animates. They are looking at the field they
 * committed it in, and a flourish over their own words reads as the app
 * answering back rather than as news.
 *
 * Compose the returned `className` onto the element holding the title text and
 * pass `onAnimationEnd` to it, so a later change can sweep again. The element
 * must be the text alone: the sweep is a mask, and anything sharing the box --
 * an icon, a status dot -- would be wiped in along with it.
 *
 * Armed by a change, never by a mount. A title already on screen when the
 * element draws is not arriving, which is what keeps a virtualized row
 * scrolling back into view, or a task page reopened in another tab, from
 * replaying a name that settled long ago.
 */
export function useTitleArrival(
  id: TaskId,
  title: string,
): { className: string | undefined; onAnimationEnd: () => void } {
  const [renderedTitle, setRenderedTitle] = useState(title);
  const [arrivingTitle, setArrivingTitle] = useState<null | string>(null);

  if (renderedTitle !== title) {
    setRenderedTitle(title);
    setArrivingTitle(titlesRenamedByUser.get(id) === title ? null : title);
  }

  return {
    className: arrivingTitle === title ? "title-arrival" : undefined,
    onAnimationEnd: () => {
      setArrivingTitle(null);
    },
  };
}
