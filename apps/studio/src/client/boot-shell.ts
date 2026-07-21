import { applyInitialTheme } from "@/client/lib/initial-theme";
import {
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  ZOOM_STORAGE_KEY,
} from "@/client/lib/storage-keys";
import {
  BOOT_SHELL_ATTRIBUTES,
  BOOT_SHELL_CSS_VARS,
} from "@/shared/boot-shell";
import { SIDEBAR_WIDTH, TOOLBAR_HEIGHT } from "@/shared/constants";

/**
 * Themes and sizes the boot shell markup in `index.html`: the empty app frame
 * the user sees, and can drag the window by, between the window appearing and
 * the renderer mounting. It ships as its own entry script ahead of `main.tsx`
 * so it runs without waiting on the app's module graph, which in development is
 * most of that gap. Keep its imports to constants for the same reason.
 *
 * Everything here is a refinement of the defaults already in the markup, so a
 * missing or corrupt value just leaves the shell at its default geometry.
 */

const root = document.documentElement;

applyInitialTheme();

// The onboarding window draws no toolbar or sidebar, only a drag strip.
root.setAttribute(
  BOOT_SHELL_ATTRIBUTES.windowType,
  window.api.windowType ?? "main",
);
root.setAttribute(
  BOOT_SHELL_ATTRIBUTES.sidebarOpen,
  String(readStored(SIDEBAR_OPEN_STORAGE_KEY) !== false),
);

root.style.setProperty(
  BOOT_SHELL_CSS_VARS.toolbarHeight,
  `${TOOLBAR_HEIGHT}px`,
);
root.style.setProperty(
  BOOT_SHELL_CSS_VARS.sidebarWidth,
  `${readPositiveNumber(SIDEBAR_WIDTH_STORAGE_KEY) ?? SIDEBAR_WIDTH}px`,
);
// A zero or negative zoom makes the shell's `100vh / zoom` sizing collapse, so
// only a positive factor is applied.
root.style.setProperty(
  BOOT_SHELL_CSS_VARS.zoom,
  String(readPositiveNumber(ZOOM_STORAGE_KEY) ?? 1),
);

function readPositiveNumber(key: string) {
  const value = readStored(key);
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readStored(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
