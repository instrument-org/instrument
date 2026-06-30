import { base } from "@/electron-main/rpc/base";
import { getStudioOverlay } from "@/electron-main/studio-overlay";
import {
  StudioOverlayRequestSchema,
  StudioOverlayResultSchema,
} from "@/shared/studio-overlay";

const show = base
  .input(StudioOverlayRequestSchema)
  .output(StudioOverlayResultSchema)
  .handler(async ({ input }) => {
    const controller = getStudioOverlay();
    if (!controller) {
      return { completed: false };
    }
    return controller.show(input);
  });

// The renderer reports that its flow completed; non-completion outcomes
// (dismiss/error/replace) are owned by the controller, not callers.
const resolve = base.handler(() => {
  getStudioOverlay()?.resolve();
});

const dismiss = base.handler(() => {
  getStudioOverlay()?.dismiss();
});

export const studioOverlay = {
  dismiss,
  resolve,
  show,
};
