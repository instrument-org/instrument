import { ClearBrowsingDataModal } from "@/client/components/studio-modals/clear-browsing-data-modal";
import { LoginModal } from "@/client/components/studio-modals/login-modal";
import { ReportDialog } from "@/client/components/studio-modals/report-dialog";
import { SettingsModal } from "@/client/components/studio-modals/settings-modal";
import { ShortcutGuideModal } from "@/client/components/studio-modals/shortcut-guide-modal";

/**
 * Mounts the app-wide modals once at the window root so each `<Dialog>`
 * floats over everything. Each reads its own atom (a view over the shared
 * `studioModalAtom` slot) and renders nothing until opened; at most one is
 * open at a time — opening another replaces it rather than stacking (e.g.
 * sign-in triggered from inside settings).
 */
export function StudioModals() {
  return (
    <>
      <ClearBrowsingDataModal />
      <LoginModal />
      <ReportDialog />
      <SettingsModal />
      <ShortcutGuideModal />
    </>
  );
}
