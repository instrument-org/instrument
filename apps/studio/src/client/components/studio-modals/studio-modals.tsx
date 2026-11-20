import { ClearBrowsingDataModal } from "@/client/components/studio-modals/clear-browsing-data-modal";
import { ExtensionInstallModal } from "@/client/components/studio-modals/extension-install-modal";
import { LoginModal } from "@/client/components/studio-modals/login-modal";
import { ReportDialog } from "@/client/components/studio-modals/report-dialog";
import { ShortcutGuideModal } from "@/client/components/studio-modals/shortcut-guide-modal";
import { ProjectDetailsModal } from "@/client/components/studio-modals/project-details-modal";
import { BuiltInPageOpener } from "@/client/components/window/built-in-pages";

/**
 * Mounts the app-wide modals once at the window root so each `<Dialog>`
 * floats over everything. Each reads its own atom (a view over the shared
 * `studioModalAtom` slot) and renders nothing until opened; at most one is
 * open at a time — opening another replaces it rather than stacking (e.g.
 * sign-in triggered from inside settings). Beside them, the opener of the
 * built-in pages (Settings, Memory, Skills, History), which open as tabs.
 */
export function StudioModals() {
  return (
    <>
      <ClearBrowsingDataModal />
      <ExtensionInstallModal />
      <LoginModal />
      <ReportDialog />
      <BuiltInPageOpener />
      <ShortcutGuideModal />
      <ProjectDetailsModal />
    </>
  );
}
