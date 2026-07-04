import { DeleteTaskModal } from "@/client/components/studio-modals/delete-task-modal";
import { LoginModal } from "@/client/components/studio-modals/login-modal";
import { ProjectModal } from "@/client/components/studio-modals/project-modal";
import { SettingsModal } from "@/client/components/studio-modals/settings-modal";
import { WelcomeModal } from "@/client/components/studio-modals/welcome-modal";

/**
 * Mounts the app-wide modals once at the app-chrome root so each `<Dialog>`
 * floats over the sidebar and content alike. Each reads its own atom (a view
 * over the shared `studioModalAtom` slot) and renders nothing until opened;
 * at most one is open at a time — opening another replaces it rather than
 * stacking (e.g. sign-in triggered from inside settings). Contextual modals
 * (delete-project) mount inline next to their triggers instead.
 */
export function StudioModals() {
  return (
    <>
      <ProjectModal />
      <LoginModal />
      <WelcomeModal />
      <SettingsModal />
      <DeleteTaskModal />
    </>
  );
}
