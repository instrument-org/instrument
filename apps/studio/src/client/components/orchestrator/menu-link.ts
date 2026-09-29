/**
 * The link a right click inside text being edited was over, answered by the
 * surface it was drawn in, for the window's native menu to open once a row
 * of it is picked. The menu is the OS's, so the pick arrives from the main
 * process after the click has long returned.
 */
let menuLink: ((options: { newTab: boolean }) => void) | null = null;

// Every right click forgets the last one's link on its way down, before the
// surface under the pointer names its own, so a menu raised over anything
// else never opens a link from an earlier menu that was dismissed.
if (typeof window !== "undefined") {
  window.addEventListener(
    "contextmenu",
    () => {
      menuLink = null;
    },
    { capture: true },
  );
}

/** Opens the link the window's native menu was raised over, where its surface says. */
export function openMenuLink(options: { newTab: boolean }) {
  menuLink?.(options);
  menuLink = null;
}

/** Remembers how to open the link a native menu is being raised over, or that there is none. */
export function setMenuLink(
  open: ((options: { newTab: boolean }) => void) | null,
) {
  menuLink = open;
}
