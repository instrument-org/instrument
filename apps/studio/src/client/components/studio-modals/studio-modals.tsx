import { DeleteTaskModal } from "@/client/components/studio-modals/delete-task-modal";
import { LoginModal } from "@/client/components/studio-modals/login-modal";
import { ProjectModal } from "@/client/components/studio-modals/project-modal";
import { SettingsModal } from "@/client/components/studio-modals/settings-modal";
import { WelcomeModal } from "@/client/components/studio-modals/welcome-modal";

/**
 * Mounts the app-wide modals once at the app-chrome root so each `<Dialog>`
 * floats over the sidebar and content alike. Each reads its own atom and renders
 * nothing until opened, so they're independent and stack like ordinary dialogs.
 * Contextual modals (delete-project, delete-task) mount inline next to their
 * triggers instead.
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
