import { useState } from "react";

import { type Chat } from "./chats";

export interface TitleArrival {
  className: string | undefined;
  onAnimationEnd: () => void;
}

/**
 * The sweep a chat's title arrives under when the app names it while it is on
 * screen.
 *
 * A chat is named from its first message a moment after it opens, and again
 * once its first exchange settles, so the title under the person's eye is
 * replaced while they are reading it. Swapped outright it reads as a glitch;
 * swept in left to right, it reads as the chat being named.
 *
 * Who named it is the chat's own fact (`titleByApp`, from its settings), so
 * a rename the person typed, here or on another computer, stays still.
 *
 * Armed by a change of title under one chat, never by a mount or by the
 * element being handed another chat: a row scrolling back into view, a
 * header switching chats, or a list re-sorting shows a title that has been
 * the chat's all along.
 *
 * Put `className` on the element holding the title's text alone, since the
 * sweep is a mask, and pass it `onAnimationEnd` so a later name can sweep
 * again.
 */
export function useTitleArrival({
  id,
  title,
  titleByApp,
}: Pick<Chat, "id" | "title" | "titleByApp">): TitleArrival {
  const [shown, setShown] = useState({ id, title });
  const [arriving, setArriving] = useState<null | string>(null);
  if (shown.id !== id || shown.title !== title) {
    setShown({ id, title });
    setArriving(shown.id === id && titleByApp ? title : null);
  }
  return {
    className: arriving === title ? "title-arrival" : undefined,
    onAnimationEnd: () => {
      setArriving(null);
    },
  };
}
