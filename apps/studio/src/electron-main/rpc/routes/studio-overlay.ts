import {
  base,
} from "@/electron-main/rpc/base";
import {
  StudioOverlayRequestSchema,
  StudioOverlayResultSchema,
} from "@/shared/studio-overlay";

const show = base
  .input(StudioOverlayRequestSchema)
  .output(StudioOverlayResultSchema)
  .handler(async ({ context, input }) => {
    const controller = context.tabsManager?.studioOverlay;
    if (!controller) {
      return { completed: false };
    }
    return controller.show(input);
  });

// The renderer reports that its flow completed; non-completion outcomes
// (dismiss/error/replace) are owned by the controller, not callers.
const resolve = base.handler(({ context }) => {
  context.tabsManager?.studioOverlay.resolve();
});

const dismiss = base.handler(({ context }) => {
  context.tabsManager?.studioOverlay.dismiss();
});

export const studioOverlay = {
  dismiss,
  resolve,
  show,
};
