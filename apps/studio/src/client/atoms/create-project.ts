import { atom, useSetAtom } from "jotai";

// Drives the app-wide New Project modal. Mounted once in the _app layout so any
// surface (sidebar, task menus, prompt-input selector) can open it.
export const createProjectDialogOpenAtom = atom(false);

// Opens the app-wide New Project modal from any surface.
export function useOpenCreateProject() {
  const setOpen = useSetAtom(createProjectDialogOpenAtom);
  return () => {
    setOpen(true);
  };
}
