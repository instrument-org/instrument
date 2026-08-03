import { isStudioModalOpenAtom } from "@/client/atoms/studio-modal";
import { taskFileViewerAtom } from "@/client/atoms/task-file-viewer";
import { useAtomValue } from "jotai";

/**
 * Whether a full-window overlay is currently drawn over the page, for a host
 * that shows a browser guest.
 *
 * The guest is mounted on `document.body`, outside every dialog's subtree, so
 * no overlay occludes it the way it occludes ordinary content -- it keeps
 * painting over the dim layer as though nothing opened. Opening a dialog is
 * also not a tab switch, which is the only park signal `useBrowserSlot`
 * otherwise receives, so a host under an overlay has to say so itself.
 *
 * Covers both overlay sources: the app-wide studio modals (settings, sign-in,
 * ...) and the file viewer's expand modal. A host that lives *inside* one of
 * those overlays wants the opposite treatment -- keep painting, but raised
 * above the overlay -- so it passes a z-index rather than this.
 */
export function useIsGuestCovered(): boolean {
  const studioModalOpen = useAtomValue(isStudioModalOpenAtom);
  const fileViewerModalOpen = useAtomValue(taskFileViewerAtom).isModalOpen;
  return studioModalOpen || fileViewerModalOpen;
}
