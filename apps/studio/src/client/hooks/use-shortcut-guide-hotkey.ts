import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { SHORTCUTS } from "@/shared/shortcuts";
import { useStore } from "jotai";
import { useEffect } from "react";

const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Opens the shortcut guide on `?`. The chord lives here rather than in the
 * native menu (or the main-process binder) because it carries no modifier and is
 * layout-dependent: it is a character before it is a shortcut, so it has to
 * yield to whatever the user is typing into.
 *
 * It also yields to any modal. `?` is cheap to press by accident, and the
 * modals it could land on are ones the user is mid-way through (settings, a
 * delete confirmation) or must not lose (the onboarding gate) -- so while
 * anything is blocking, `?` does nothing and the Help menu item stays the way
 * in. Escape closes the guide; a second `?` doesn't toggle it, since by then
 * the guide itself is what's blocking.
 */
export function useShortcutGuideHotkey() {
  const store = useStore();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== SHORTCUTS.shortcutGuide.accelerator ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.defaultPrevented
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest(EDITABLE_SELECTOR))
      ) {
        return;
      }
      if (store.get(blockingModalCountAtom) > 0) {
        return;
      }
      event.preventDefault();
      openShortcutGuide();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);
}
