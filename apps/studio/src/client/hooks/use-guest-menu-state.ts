import { useEffect, useState } from "react";

/**
 * Controlled open state for a menu that floats over a browser guest.
 *
 * Clicking into the guest `<webview>` — a separate WebContents — blurs the host
 * window but never dispatches a pointer or focus event Radix can see, so its own
 * outside-dismiss never fires and the menu would stay stuck open over the page
 * with no way to click it away. Closing on window blur is what dismisses it, and
 * it is why such a menu is also rendered `modal={false}`: the modal layer's body
 * `pointer-events: none` would otherwise swallow the very click into the guest
 * that this relies on.
 */
export function useGuestMenuState() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => {
      setOpen(false);
    };
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("blur", close);
    };
  }, [open]);

  return [open, setOpen] as const;
}
