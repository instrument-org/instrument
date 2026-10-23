import { coveringOverlayCountAtom } from "@/client/atoms/guest-coverage";
import { useAtomValue } from "jotai";

/**
 * Whether a full-window overlay is currently drawn over the page, for a host
 * that shows a browser guest. The dim layer stacks over the guest like over
 * any other element, so the page stays in view; a covered host only stops
 * being the page Cmd+F and Cmd+R reach.
 *
 * Every overlay registers itself through `useCoversGuests`, so this answers for
 * the app-wide studio modals, the command palette, the contextual dialogs that
 * live on local state, the file viewer's expand modal, and the chat's
 * image/diagram preview alike, without knowing that any of them exist.
 */
export function useIsGuestCovered({
  insideOverlay = false,
}: {
  /** Whether the host is itself drawn inside an overlay, whose own cover does not count against it. */
  insideOverlay?: boolean;
} = {}): boolean {
  return useAtomValue(coveringOverlayCountAtom) > (insideOverlay ? 1 : 0);
}
