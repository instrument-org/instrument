/**
 * The link a right click inside text being edited was over, answered by the
 * surface it was drawn in, for the window's native menu to open once a row
 * of it is picked. The menu is the OS's, so the pick arrives from the main
 * process after the click has long returned.
 */
let menuLink: ((options: { newTab: boolean }) => void) | null = null;

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
