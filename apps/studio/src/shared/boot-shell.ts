/**
 * The contract between the boot shell markup in `src/index.html` and the code
 * around it. That markup has to stand alone -- it paints before any script or
 * stylesheet is fetched -- so it spells these names and colors out as literals.
 * Everything that participates imports them from here instead of repeating them
 * again, and `client/boot-shell.test.ts` fails if the markup drifts from them.
 */

export const BOOT_SHELL_ATTRIBUTES = {
  sidebarOpen: "data-sidebar-open",
  windowType: "data-window-type",
} as const;

/** Mirrors globals.css: --background, the toolbar's gray ramp, and --border. */
export const BOOT_SHELL_COLORS = {
  dark: {
    background: "#1c1917",
    border: "rgb(255 255 255 / 10%)",
    toolbar: "#292524",
  },
  light: {
    background: "#fafaf9",
    border: "#e7e5e4",
    toolbar: "#e7e5e4",
  },
} as const;

export const BOOT_SHELL_CSS_VARS = {
  sidebarWidth: "--boot-sidebar-width",
  toolbarHeight: "--boot-toolbar-height",
  zoom: "--boot-zoom",
} as const;

export const BOOT_SHELL_ELEMENT_IDS = {
  body: "boot-shell-body",
  root: "boot-shell",
  sidebar: "boot-shell-sidebar",
  toolbar: "boot-shell-toolbar",
} as const;
