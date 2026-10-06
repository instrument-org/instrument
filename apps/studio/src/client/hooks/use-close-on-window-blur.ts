import { useEffect, useEffectEvent } from "react";

/**
 * Closes something floating over a page when the window loses focus. A press
 * in a page's `<webview>` (a separate WebContents) blurs the window without a
 * pointer or focus event Radix can see, so its own outside-dismiss never
 * fires and a menu or popover would stay open over the page.
 */
export function useCloseOnWindowBlur(isOpen: boolean, close: () => void) {
  const onBlur = useEffectEvent(close);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handle = () => {
      onBlur();
    };
    window.addEventListener("blur", handle);
    return () => {
      window.removeEventListener("blur", handle);
    };
  }, [isOpen]);
}
