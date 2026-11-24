import {
  focusHomeIn,
  focusOnceLayersClose,
  isKeyboardNowhere,
} from "@/client/lib/keyboard-home";
import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * Puts the caret in a side's home as the side takes the keyboard, or as
 * another tab or group comes up on the side that has it: a side's card stays
 * as the group it draws changes, and what it showed goes with the caret.
 * A caret somewhere else on screen stays, and a press on the side places its
 * own. With a menu up, it waits for the caret the menu hands back as it goes.
 */
export function useSideCaret({
  cardRef,
  hasKeyboard,
  isCaretOnOtherSide,
  isPressed,
  shown,
}: {
  cardRef: RefObject<HTMLElement | null>;
  /** Whether the side has the keyboard, in a group on screen. */
  hasKeyboard: boolean;
  isCaretOnOtherSide: () => boolean;
  isPressed: RefObject<boolean>;
  /** The group and tab the side shows. */
  shown: string | undefined;
}) {
  const takeCaret = useEffectEvent(() => {
    const card = cardRef.current;
    if (!card) {
      return;
    }
    if (document.querySelector("[data-radix-focus-guard]") !== null) {
      focusOnceLayersClose({
        focus: () => {
          focusHomeIn(card);
        },
        holds: () => !isCaretOnOtherSide() && !isKeyboardNowhere(),
      });
    } else if (
      isCaretOnOtherSide() ||
      (isKeyboardNowhere() && !isPressed.current)
    ) {
      focusHomeIn(card);
    }
  });
  useEffect(() => {
    if (hasKeyboard && shown !== undefined) {
      takeCaret();
    }
  }, [hasKeyboard, shown]);
}
