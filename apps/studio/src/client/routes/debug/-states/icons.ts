import { type DebugStateEntry } from "./types";

/** The states this page draws, each reached at its `?state=`. */
export const iconsStates = [
  { id: "open-button", label: "Open button", tab: "apps" },
  { id: "open-button-bordered", label: "Open button, bordered", tab: "apps" },
  { id: "chip-in-reply", label: "Chip in an assistant reply", tab: "apps" },
  {
    id: "chip-in-chat-bubble",
    label: "Chip in the chat's user bubble",
    tab: "apps",
  },
  {
    id: "chip-in-task-bubble",
    label: "Chip in a task page's user bubble",
    tab: "apps",
  },
  { id: "slash-menu-rows", label: "Slash menu rows", tab: "apps" },
  { id: "menu-rows", label: "Menu rows", tab: "apps" },
  { id: "tab-location-row", label: "Tab and location row", tab: "apps" },
  { id: "connect-card", label: "Connect card", tab: "apps" },
  { id: "app-page-header", label: "App page header", tab: "apps" },
  { id: "apps-home-marks", label: "Apps and zero-state marks", tab: "apps" },
  { id: "catalog-tile", label: "Catalog tile", tab: "apps" },
  { id: "app-without-icon", label: "App with no icon", tab: "apps" },
  { id: "app-search", label: "Any app, on every ground", tab: "apps" },
  { id: "providers-grid", label: "Provider marks", tab: "providers" },
  { id: "everyday-files", label: "Everyday files", tab: "files" },
  { id: "folders", label: "Folders", tab: "files" },
  { id: "file-without-icon", label: "File with no icon", tab: "files" },
  { id: "glyphs", label: "File glyphs", tab: "files" },
] as const satisfies readonly DebugStateEntry[];
