import { sendAppCommand } from "@/electron-main/app-command";
import { isAcceleratorAvailable } from "@/electron-main/lib/quick-capture-shortcut";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import { getPreferencesStore } from "@/electron-main/stores/preferences";
import { ensureMainWindowVisible } from "@/electron-main/windows/main";
import { focusMainContents } from "@/electron-main/windows/main/controls";
import {
  hideQuickCaptureOverlay,
  setQuickCaptureOverlayHeight,
  toggleQuickCaptureOverlay,
} from "@/electron-main/windows/overlay";
import { TaskIdSchema } from "@instrument-org/workspace/electron";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

const hide = base.handler(() => {
  hideQuickCaptureOverlay();
});

/**
 * Hand the task the panel is showing over to the real window. The panel is for
 * reading and replying; anything past that -- files, the browser, artifacts --
 * lives in the main window, and this is the door to it.
 */
const openTaskInMainWindow = base
  .input(z.object({ id: TaskIdSchema }))
  .handler(async ({ input }) => {
    hideQuickCaptureOverlay();

    await ensureMainWindowVisible();
    sendAppCommand({
      newTab: true,
      params: { id: input.id },
      to: "/tasks/$id/",
      type: "navigate",
    });
    focusMainContents();
  });

/**
 * The same thing the hotkey does. Worth having as a route as well: the chord can
 * already be held by another app, and this is how the panel is reachable (and
 * testable) when it is.
 */
const toggle = base.handler(() => {
  toggleQuickCaptureOverlay();
});

const setHeight = base
  .input(z.object({ height: z.number().min(120).max(900) }))
  .handler(({ input }) => {
    setQuickCaptureOverlayHeight(input.height);
  });

/**
 * Save a chord, refusing one the OS will not give us. Reporting `taken` rather
 * than throwing lets the recorder say so in place and keep the old binding,
 * which beats saving a shortcut that silently never fires.
 */
const setAccelerator = base
  .input(z.object({ accelerator: z.string() }))
  .output(z.object({ saved: z.boolean(), taken: z.boolean() }))
  .handler(({ input }) => {
    if (input.accelerator && !isAcceleratorAvailable(input.accelerator)) {
      return { saved: false, taken: true };
    }

    getPreferencesStore().set("quickCaptureAccelerator", input.accelerator);
    return { saved: true, taken: false };
  });

const live = {
  dismissed: base
    .output(eventIterator(z.object({ at: z.number() })))
    .handler(async function* ({ signal }) {
      for await (const _ of publisher.subscribe("overlay.dismissed", {
        signal,
      })) {
        yield { at: Date.now() };
      }
    }),
};

export const overlay = {
  hide,
  live,
  openTaskInMainWindow,
  setAccelerator,
  setHeight,
  toggle,
};
