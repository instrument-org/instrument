import { useEffect, useRef, useState } from "react";

/** How long the pointer rests on Chat in the rail before the inbox peeks out, so a pass over the rail on the way somewhere else shows nothing. */
const PEEK_OPEN_MS = 300;
/** How long the pointer may be off both Chat and the peek before it goes, room to cross from one to the other. */
const PEEK_CLOSE_MS = 250;

/**
 * The inbox peeking out beside the rail while the pointer rests on Chat and
 * the list is nowhere on screen: the inbox put away beside a chat, or
 * another place up. Chat in the rail pins it the way it always has; the
 * peek is for a glance, and for going to another chat without moving
 * anything. Leaving both Chat and the peek puts it away, unless a menu of
 * its own is up or the keyboard is in it (its search), when a press outside
 * it or Escape does.
 */
export function useInboxPeek({ canPeek }: { canPeek: boolean }) {
  const [isOpen, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // The list come on screen puts the peek away, so it is not waiting there
  // when the list goes again.
  const [wasPeekable, setWasPeekable] = useState(canPeek);
  if (canPeek !== wasPeekable) {
    setWasPeekable(canPeek);
    if (!canPeek) {
      setOpen(false);
    }
  }

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const close = () => {
    clear();
    setOpen(false);
  };
  const isHeld = () =>
    isFloatingUp() || (panel?.contains(document.activeElement) ?? false);
  const scheduleClose = () => {
    clear();
    timer.current = setTimeout(() => {
      if (!isHeld()) {
        setOpen(false);
      }
    }, PEEK_CLOSE_MS);
  };

  useEffect(() => clear, []);
  // Nor is one on its way out when the list is already on screen.
  useEffect(() => {
    if (!canPeek) {
      clear();
    }
  }, [canPeek]);

  // Held open by its search or a menu of its own, it goes on a press
  // anywhere outside it and its menus, or on Escape with no menu up. A press
  // on Chat is left to its click, which pins the list where the peek is.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (panel?.contains(target) ||
          target.closest("[data-radix-popper-content-wrapper]") ||
          target.closest("[data-peeks-inbox]"))
      ) {
        return;
      }
      clear();
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isFloatingUp()) {
        clear();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, panel]);

  return {
    close,
    isOpen: isOpen && canPeek,
    /** The list come on screen where the peek was, so the peek goes at once and the list stands in its place. */
    leavesAtOnce: !canPeek,
    onPointerEnter: clear,
    onPointerLeave: scheduleClose,
    panelRef: setPanel,
    /** Told when the pointer comes onto Chat in the rail and leaves it. */
    onRailHover: (isOver: boolean) => {
      if (!canPeek) {
        return;
      }
      clear();
      if (!isOver) {
        scheduleClose();
      } else if (!isOpen) {
        timer.current = setTimeout(() => {
          // Only while the list is still nowhere on screen.
          setOpen(canPeek);
        }, PEEK_OPEN_MS);
      }
    },
  };
}

/** Whether a menu, popover or select is up, which draws outside the peek while belonging to it. */
function isFloatingUp() {
  return document.querySelector("[data-radix-popper-content-wrapper]") !== null;
}
