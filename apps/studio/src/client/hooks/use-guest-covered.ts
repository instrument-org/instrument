import { isStudioModalOpenAtom } from "@/client/atoms/studio-modal";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { useAtomValue } from "jotai";

/**
 * The full-window overlays currently drawn over the page, reported separately
 * because a host that shows a browser guest cares which one.
 *
 * The guest is mounted on `document.body`, outside every dialog's subtree, so
 * no overlay occludes it the way it occludes ordinary content -- it keeps
 * painting over the dim layer as though nothing opened. Opening a dialog is
 * also not a tab switch, which is the only park signal `useBrowserSlot`
 * otherwise receives, so a host under an overlay has to say so itself.
 *
 * The two sources are independent: the file viewer's expand modal is driven by
 * `taskFileViewerAtom` while settings, sign-in and the rest share the
 * `studioModalAtom` slot, so a menu accelerator can open one over the other. A
 * host living *inside* one of them must ignore that one and still park for the
 * other -- which is why this returns both rather than a single verdict.
 */
export function useGuestOverlays(): {
  fileViewerModalOpen: boolean;
  studioModalOpen: boolean;
} {
  const studioModalOpen = useAtomValue(isStudioModalOpenAtom);
  const fileViewerModalOpen = useAtomValue(taskFileViewerAtom).isModalOpen;
  return { fileViewerModalOpen, studioModalOpen };
}

/**
 * Whether any full-window overlay covers a guest host that sits in the ordinary
 * page flow, i.e. one that is inside none of them. See {@link useGuestOverlays}.
 */
export function useIsGuestCovered(): boolean {
  const { fileViewerModalOpen, studioModalOpen } = useGuestOverlays();
  return studioModalOpen || fileViewerModalOpen;
}
