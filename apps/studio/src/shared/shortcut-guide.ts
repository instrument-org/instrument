import { SHORTCUT_ENTRIES, type ShortcutAccelerator } from "@/shared/shortcuts";
import {
  WINDOW_MENU_SHORTCUTS,
  WINDOW_SHORTCUTS,
  type WindowMenuShortcutId,
  type WindowShortcutId,
} from "@/shared/window-shortcuts";

/**
 * The guide's own chord and name. `?` carries no modifier and depends on the
 * keyboard layout, so the renderer answers it, yielding to a field being typed
 * into; the Help menu offers the guide under this name with no accelerator.
 */
export const SHORTCUT_GUIDE = {
  accelerator: "?",
  label: "Keyboard Shortcuts",
} as const;

export type ShortcutGuideGroup =
  | "Chats"
  | "Developer"
  | "General"
  | "Pages"
  | "Tabs"
  | "View";

/** The order the guide draws its sections in. */
export const SHORTCUT_GUIDE_GROUPS: ShortcutGuideGroup[] = [
  "General",
  "Chats",
  "Tabs",
  "Pages",
  "View",
  "Developer",
];

export interface ShortcutGuideEntry {
  accelerator: ShortcutAccelerator;
  group: ShortcutGuideGroup;
  id: string;
  label: string;
}

/**
 * Where each of the window's chords sits in the guide. Typed against both
 * tables, so a chord added to either one does not build until it is placed.
 */
const WINDOW_GROUPS: Record<
  WindowMenuShortcutId | WindowShortcutId,
  ShortcutGuideGroup
> = {
  actualSize: "View",
  back: "Pages",
  closeTab: "Tabs",
  closeWindow: "General",
  editPage: "Pages",
  findInPage: "Pages",
  forward: "Pages",
  lastTab: "Tabs",
  newChat: "General",
  newTab: "Tabs",
  nextChat: "Chats",
  nextTab: "Tabs",
  previousChat: "Chats",
  previousTab: "Tabs",
  reloadPage: "Pages",
  reopenTab: "Tabs",
  search: "General",
  tabByPlace: "Tabs",
  toggleFullScreen: "View",
  toggleInbox: "Chats",
  zoomIn: "View",
  zoomOut: "View",
};

const WINDOW_CHORDS: Record<
  WindowMenuShortcutId | WindowShortcutId,
  { accelerator: ShortcutAccelerator; label: string }
> = { ...WINDOW_SHORTCUTS, ...WINDOW_MENU_SHORTCUTS };

/**
 * Every chord the app window answers to, read off the tables the menus and
 * key binders are built from, so the guide cannot list a chord the window
 * lacks or miss one it has. Key order carries no meaning; the guide orders
 * rows itself.
 */
export const SHORTCUT_GUIDE_ENTRIES: ShortcutGuideEntry[] = [
  { ...SHORTCUT_GUIDE, group: "General", id: "shortcutGuide" },
  ...Object.entries(WINDOW_CHORDS).map(([id, { accelerator, label }]) => ({
    accelerator,
    // `Object.entries` widens the keys to `string`; they are the tables' ids.
    group: WINDOW_GROUPS[id as WindowMenuShortcutId | WindowShortcutId],
    id,
    label,
  })),
  ...SHORTCUT_ENTRIES.map(({ descriptor, id }) => ({
    accelerator: descriptor.accelerator,
    group: descriptor.group,
    id,
    label: descriptor.label,
  })),
];
