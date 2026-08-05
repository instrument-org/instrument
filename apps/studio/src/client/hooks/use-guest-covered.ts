import { coveringOverlayCountAtom } from "@/client/atoms/guest-coverage";
import { useAtomValue } from "jotai";

/**
 * Whether a full-window overlay is currently drawn over the page, for a host
 * that shows a browser guest.
 *
 * The guest is mounted on `document.body`, outside every dialog's subtree, so no
 * overlay occludes it the way it occludes ordinary content -- it keeps painting
 * over the dim layer as though nothing opened. Opening a dialog is also not a
 * tab switch, which is the only park signal `useBrowserSlot` otherwise receives,
 * so a covered host has to say so itself.
 *
 * Every overlay registers itself through `useCoversGuests`, so this answers for
 * the app-wide studio modals, the command palette, the contextual dialogs that
 * live on local state, the file viewer's expand modal, and the chat's
 * image/diagram preview alike, without knowing that any of them exist.
 */
export function useIsGuestCovered(): boolean {
  return useAtomValue(coveringOverlayCountAtom) > 0;
}
