import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { focusReplyBox } from "../lib/keyboard-home";
import { cn } from "../lib/utils";
import { FOLD_TRANSITION } from "./transcript/card-motion";

const FOLD_MS = FOLD_TRANSITION.duration * 1000;
const FOLD_EASE = `cubic-bezier(${FOLD_TRANSITION.ease.join(", ")})`;

/**
 * The card a chat waits on the person with, docked above its reply box: the
 * first of what is open (`first`), drawn by `children`. It opens from nothing
 * to its height and, once nothing is left open, folds back to nothing,
 * holding the last card as it was meanwhile (`isLeaving`), on the fold's own
 * curve, so the transcript above it moves with it a frame at a time rather
 * than jumping. The keyboard in a card that goes moves on to the card that
 * takes its place, or to the reply box once none does.
 */
export function ComposerDock<Card extends { id: string }>({
  children,
  first,
}: {
  children: (card: Card, isLeaving: boolean) => ReactNode;
  first: Card | undefined;
}) {
  const [shown, setShown] = useState(first);
  const [leaving, setLeaving] = useState<Card>();
  if (first?.id !== shown?.id) {
    setShown(first);
    setLeaving(first === undefined ? shown : undefined);
  }
  useEffect(() => {
    if (leaving === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setLeaving(undefined);
    }, FOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);
  const card = first ?? leaving;
  if (card === undefined) {
    return null;
  }
  const isLeaving = first === undefined;
  return (
    <DockFold cardId={card.id} isLeaving={isLeaving}>
      {children(card, isLeaving)}
    </DockFold>
  );
}

/** The fold a docked card opens and closes in, mounted as the first card comes up. */
function DockFold({
  cardId,
  children,
  isLeaving,
}: {
  cardId: string;
  children: ReactNode;
  isLeaving: boolean;
}) {
  // Drawn closed for a frame, so the height it opens to is transitioned to.
  const [isOpened, setIsOpened] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      setIsOpened(true);
      timer = setTimeout(() => {
        setIsSettled(true);
      }, FOLD_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  const dockRef = useRef<HTMLDivElement>(null);
  // Whether the keyboard was in the dock, kept past a card taken away with
  // it, which leaves it on nothing.
  const hadKeyboard = useRef(false);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const focused = document.activeElement;
    if (!dock) {
      return;
    }
    const isLost =
      (focused instanceof HTMLElement && dock.contains(focused)) ||
      (hadKeyboard.current && (focused === null || focused === document.body));
    if (isLost) {
      if (isLeaving) {
        // Off the card first, which goes inert as it folds.
        if (focused instanceof HTMLElement) {
          focused.blur();
        }
        focusReplyBox(dock);
      } else if (!dock.contains(focused) && !focusDockedCard(dock)) {
        focusReplyBox(dock);
      }
    }
    hadKeyboard.current = dock.contains(document.activeElement);
  }, [cardId, isLeaving]);

  const isOpen = isOpened && !isLeaving;
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] motion-reduce:transition-none",
        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
      )}
      data-composer-dock=""
      inert={isLeaving}
      onBlur={(event) => {
        const left = event.target;
        // A card taken away with the keyboard in it blurs as it goes, and
        // that keyboard is the next card's to take.
        queueMicrotask(() => {
          if (left.isConnected) {
            hadKeyboard.current =
              dockRef.current?.contains(document.activeElement) ?? false;
          }
        });
      }}
      onFocus={() => {
        hadKeyboard.current = true;
      }}
      ref={dockRef}
      style={{
        transitionDuration: `${String(FOLD_MS)}ms`,
        transitionTimingFunction: FOLD_EASE,
      }}
    >
      <div
        className={cn(
          "min-h-0",
          (!isSettled || isLeaving) && "overflow-hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Puts the keyboard on the first choice of the question on show in an open
 * card under `root`, on a card's own first answer (`data-card-home`), or
 * else on its first button. Returns whether anything took it.
 */
export function focusDockedCard(root: HTMLElement) {
  const reachable = (element: HTMLElement) =>
    element.closest("[inert]") === null &&
    element.checkVisibility({ visibilityProperty: true });
  const target =
    [
      ...root.querySelectorAll<HTMLElement>("[data-card-home]:not([disabled])"),
    ].find(reachable) ??
    [...root.querySelectorAll<HTMLElement>("button:not([disabled])")].find(
      reachable,
    );
  target?.focus({ preventScroll: true });
  return target !== undefined;
}
