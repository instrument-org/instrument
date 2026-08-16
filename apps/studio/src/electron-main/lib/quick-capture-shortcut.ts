import { logger } from "@/electron-main/lib/electron-logger";
import {
  getFeaturesStore,
  isFeatureEnabled,
} from "@/electron-main/stores/features";
import { getPreferencesStore } from "@/electron-main/stores/preferences";
import {
  destroyQuickCaptureOverlay,
  toggleQuickCaptureOverlay,
} from "@/electron-main/windows/overlay";
import { globalShortcut } from "electron";
import { noop } from "radashi";

// Two presses in quick succession would otherwise race show against hide and
// leave the panel in the state you did not ask for.
const TOGGLE_COOLDOWN_MS = 250;

let lastToggleAt = 0;
// What is currently bound, so a change unbinds the old chord rather than
// leaving both live.
let boundAccelerator: null | string = null;

/**
 * Keep the binding matching the flag and the chosen chord, now and whenever
 * either changes. Rebinding without a relaunch is the point: a chord is chosen
 * by trying one, finding it taken, and trying another.
 */
export function initQuickCaptureShortcut() {
  syncQuickCaptureShortcut();
  getFeaturesStore().onDidAnyChange(() => {
    syncQuickCaptureShortcut();
  });
  getPreferencesStore().onDidAnyChange(() => {
    syncQuickCaptureShortcut();
  });
}

/**
 * Whether the chord can be bound right now, without keeping it. What a
 * "record shortcut" control needs to tell the user their pick is already taken
 * before it is saved rather than after.
 */
export function isAcceleratorAvailable(accelerator: string): boolean {
  if (accelerator === boundAccelerator) {
    return true;
  }

  if (globalShortcut.isRegistered(accelerator)) {
    return false;
  }

  // Registration is the only honest test: another app holding a chord is
  // invisible to `isRegistered`, which only knows about this process.
  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, noop);
  } catch {
    return false;
  }

  if (registered) {
    globalShortcut.unregister(accelerator);
  }

  return registered;
}

export function unregisterQuickCaptureShortcut() {
  if (boundAccelerator && globalShortcut.isRegistered(boundAccelerator)) {
    globalShortcut.unregister(boundAccelerator);
  }
  boundAccelerator = null;
}

function syncQuickCaptureShortcut() {
  if (!isFeatureEnabled("quick_capture_overlay")) {
    unregisterQuickCaptureShortcut();
    // Flag off means the panel should not be sitting there hidden either.
    destroyQuickCaptureOverlay();
    return;
  }

  const accelerator = getPreferencesStore().get("quickCaptureAccelerator");

  if (accelerator === boundAccelerator) {
    return;
  }

  unregisterQuickCaptureShortcut();

  // Cleared on purpose: the panel stays reachable from the app, just not from
  // a global chord.
  if (!accelerator) {
    return;
  }

  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, () => {
      const now = Date.now();
      if (now - lastToggleAt < TOGGLE_COOLDOWN_MS) {
        return;
      }
      lastToggleAt = now;
      toggleQuickCaptureOverlay();
    });
  } catch (error) {
    // Electron throws on a malformed accelerator rather than returning false.
    logger.warn(`Invalid quick capture accelerator ${accelerator}`, error);
    return;
  }

  if (registered) {
    boundAccelerator = accelerator;
    logger.info(`Quick capture overlay bound to ${accelerator}`);
    return;
  }

  // Another app already owns the chord. Worth saying out loud: the flag is on,
  // nothing is broken, and the hotkey simply will not fire.
  logger.warn(
    `Could not bind ${accelerator} for the quick capture overlay; another app likely holds it`,
  );
}
