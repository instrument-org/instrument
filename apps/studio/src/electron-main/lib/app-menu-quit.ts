import { app } from "electron";

let quitFromMenu: () => void = () => {
  app.quit();
};

/**
 * What the app menu's Quit does on a Mac. A plain quit until the menu bar
 * icon starts (`startMenuBar`), which leaves the app running behind the icon
 * instead while that is on. Kept apart so the app menu reaches it without
 * reaching the windows the menu bar brings back.
 */
export function quitFromAppMenu() {
  quitFromMenu();
}

/** Sets what the app menu's Quit does on a Mac. */
export function setAppMenuQuit(quit: () => void) {
  quitFromMenu = quit;
}
