/**
 * The contract between the boot shell markup in `src/index.html` and the code
 * around it. That markup has to stand alone -- it paints before any script or
 * stylesheet is fetched -- so it spells these names and colors out as literals.
 * Everything that participates imports them from here instead of repeating them
 * again, and `client/boot-shell.test.ts` fails if the markup drifts from them.
 */

export const BOOT_SHELL_ATTRIBUTES = {
  /** Set by the dev panel to show the shell over the running app. */
  preview: "data-boot-shell-preview",
  selectedTab: "data-selected",
  sidebarOpen: "data-sidebar-open",
  windowType: "data-window-type",
} as const;

export const BOOT_SHELL_CLASS_NAMES = {
  tab: "boot-shell-tab",
} as const;

/**
 * Mirrors globals.css: --background, --foreground, --border, --muted (the tab's
 * loading bar), and the toolbar's gray ramp.
 */
export const BOOT_SHELL_COLORS = {
  dark: {
    background: "#1c1917",
    border: "rgb(255 255 255 / 10%)",
    foreground: "#ffffff",
    muted: "rgb(255 255 255 / 8%)",
    toolbar: "#292524",
  },
  light: {
    background: "#fafaf9",
    border: "#e7e5e4",
    foreground: "#171412",
    muted: "#f5f5f4",
    toolbar: "#e7e5e4",
  },
} as const;

/** Mirrors globals.css --elevation-soft, the selected tab's `shadow-soft`. */
export const BOOT_SHELL_SHADOWS = {
  dark: "0 1px 2px 0 rgb(0 0 0 / 0.24), 0 1px 1px 0 rgb(0 0 0 / 0.28)",
  light: "0 1px 2px 0 rgb(10 13 18 / 0.04), 0 1px 1px 0 rgb(10 13 18 / 0.05)",
} as const;

export const BOOT_SHELL_CSS_VARS = {
  gutter: "--boot-gutter",
  sidebarWidth: "--boot-sidebar-width",
  toolbarHeight: "--boot-toolbar-height",
  zoom: "--boot-zoom",
} as const;

export const BOOT_SHELL_ELEMENT_IDS = {
  body: "boot-shell-body",
  controls: "boot-shell-controls",
  nav: "boot-shell-nav",
  root: "boot-shell",
  sidebar: "boot-shell-sidebar",
  tabs: "boot-shell-tabs",
  toolbar: "boot-shell-toolbar",
} as const;
