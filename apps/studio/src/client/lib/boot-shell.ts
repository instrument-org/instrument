import {
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  TABS_STORAGE_KEY,
  ZOOM_STORAGE_KEY,
} from "@/client/lib/storage-keys";
import { isMacOS } from "@/client/lib/utils";
import {
  BOOT_SHELL_ATTRIBUTES,
  BOOT_SHELL_CLASS_NAMES,
  BOOT_SHELL_CSS_VARS,
  BOOT_SHELL_ELEMENT_IDS,
} from "@/shared/boot-shell";
import { SIDEBAR_WIDTH, TOOLBAR_HEIGHT } from "@/shared/constants";

// The boot shell is the empty app frame in index.html: the window's toolbar,
// tab strip, and sidebar drawn as static markup so the window has something to
// show, and something to drag, before the renderer mounts. This fits it to the
// state the app is about to restore.
//
// It runs from the boot entry script, ahead of the app's module graph, so its
// imports stay limited to constants and small helpers.

/** The macOS traffic-light gutter, in rem. Matches StudioToolbar's `5rem`. */
const MACOS_GUTTER_REM = 5;
const OTHER_GUTTER_REM = 1;

// Enough slots to read as a full tab strip; past this they're slivers anyway.
const MAX_TAB_SLOTS = 12;

/**
 * Shows the shell over the running app so its look can be checked without a
 * reload, dismissed with Escape or a click. Development only, from the dev panel.
 */
export function previewBootShell() {
  const root = document.documentElement;
  if (root.hasAttribute(BOOT_SHELL_ATTRIBUTES.preview)) {
    return;
  }

  syncBootShell();
  root.setAttribute(BOOT_SHELL_ATTRIBUTES.preview, "");

  const listeners = new AbortController();
  const dismiss = () => {
    root.removeAttribute(BOOT_SHELL_ATTRIBUTES.preview);
    listeners.abort();
  };

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        dismiss();
      }
    },
    { signal: listeners.signal },
  );
  // The toolbar is a drag region and swallows clicks, so this only fires below
  // it. Escape covers the rest.
  document
    .querySelector(`#${BOOT_SHELL_ELEMENT_IDS.root}`)
    ?.addEventListener("click", dismiss, { signal: listeners.signal });
}

/**
 * Fits the shell to the persisted view state: window zoom, sidebar, and tab
 * strip. Everything it sets refines a default already in the markup, so a
 * missing or corrupt value just leaves that part at its default.
 */
export function syncBootShell() {
  const root = document.documentElement;

  // The onboarding window draws no toolbar contents or sidebar, only a drag strip.
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
  // The gutter is a fixed visual width, so it divides by the zoom the shell
  // applies, exactly as the real toolbar divides by the app zoom.
  root.style.setProperty(
    BOOT_SHELL_CSS_VARS.gutter,
    `calc(${isMacOS() ? MACOS_GUTTER_REM : OTHER_GUTTER_REM}rem / var(${BOOT_SHELL_CSS_VARS.zoom}, 1))`,
  );
  // A zero or negative zoom makes the shell's `100vh / zoom` sizing collapse, so
  // only a positive factor is applied.
  root.style.setProperty(
    BOOT_SHELL_CSS_VARS.zoom,
    String(readPositiveNumber(ZOOM_STORAGE_KEY) ?? 1),
  );

  renderTabSlots();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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
    // Unknown payload: the shape is checked by the readers above.
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The persisted tab strip, read shallowly: only how many tabs there are and
 * which one is selected change what the shell draws.
 */
function readTabStrip() {
  const stored = readStored(TABS_STORAGE_KEY);
  const model = isRecord(stored) ? stored : {};
  const tabs = Array.isArray(model.tabs)
    ? model.tabs.slice(0, MAX_TAB_SLOTS)
    : [];
  const selectedIndex = tabs.findIndex(
    (tab) => isRecord(tab) && tab.id === model.selectedId,
  );

  return {
    count: Math.max(tabs.length, 1),
    selectedIndex: Math.max(selectedIndex, 0),
  };
}

function renderTabSlots() {
  const container = document.querySelector(`#${BOOT_SHELL_ELEMENT_IDS.tabs}`);
  if (!container) {
    return;
  }

  const { count, selectedIndex } = readTabStrip();

  container.replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const slot = document.createElement("div");
      slot.className = BOOT_SHELL_CLASS_NAMES.tab;
      if (index === selectedIndex) {
        slot.setAttribute(BOOT_SHELL_ATTRIBUTES.selectedTab, "");
      }
      return slot;
    }),
  );
}
