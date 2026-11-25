import { type DebugStateEntry } from "./types";

/** The states this page draws, each reached at its `?state=`. */
export const appStates = [
  { id: "settings", label: "Settings" },
  { id: "sign-in", label: "Sign in" },
  { id: "keyboard-shortcuts", label: "Keyboard shortcuts" },
  { id: "update-downloading", label: "Downloading" },
  { id: "update-check-fails", label: "Check fails" },
  { id: "update-up-to-date", label: "Up to date" },
  { id: "update-just-updated", label: "Just updated" },
  { id: "update-clear-badge", label: "Clear badge" },
  { id: "fill-bell", label: "Fill the bell" },
  { id: "notification-pop-ups", label: "Notification pop-ups" },
  { id: "run-setup-again", label: "Run setup again" },
  { id: "linux-window-edge", label: "Linux window edge" },
  { id: "quit-prompt", label: "Quit prompt" },
  { id: "crash-window", label: "Crash the window" },
] as const satisfies readonly DebugStateEntry[];
