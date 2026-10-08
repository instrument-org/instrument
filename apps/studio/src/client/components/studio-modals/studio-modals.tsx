import { PlanSheet } from "@/client/components/billing/plan-sheet";
import { LoginModal } from "@/client/components/studio-modals/login-modal";
import { SettingsModal } from "@/client/components/studio-modals/settings-modal";
import { ShortcutGuideModal } from "@/client/components/studio-modals/shortcut-guide-modal";

/**
 * Mounts the app-wide modals once at the window root so each `<Dialog>`
 * floats over everything. Each reads its own atom (a view over the shared
 * `studioModalAtom` slot) and renders nothing until opened; at most one is
 * open at a time — opening another replaces it rather than stacking (e.g.
 * sign-in triggered from inside settings). The plan sheet is the exception:
 * it stacks over Settings, since Settings is one of the places it opens from.
 */
export function StudioModals() {
  return (
    <>
      <LoginModal />
      <SettingsModal />
      <ShortcutGuideModal />
      <PlanSheet />
    </>
  );
}
