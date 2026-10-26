/**
 * The keys the editor's hints and tooltips name, written the way the system
 * the app runs on writes them: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere. The
 * chords are the ones `input.ts` and the rich text keymap answer to, held
 * with the system's command key (`command`): ⌘ on a Mac, Ctrl elsewhere.
 */
import { formatAcceleratorTextFor } from "@/shared/format-accelerator";
import { type Os, OS_CONVENTIONS } from "@/shared/os-conventions";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";

export type EditorKeys = ReturnType<typeof editorKeys>;

export function editorKeys(os: Os) {
  const chord = (accelerator: string) =>
    formatAcceleratorTextFor({ accelerator, os });
  return {
    bold: chord("CmdOrCtrl+B"),
    /** The modifier the chords are held with. */
    command: OS_CONVENTIONS[os].commandKey,
    delete: OS_CONVENTIONS[os].deleteKey,
    /** The window's Edit Page chord, which leaves the editor as it entered it. */
    done: chord(WINDOW_SHORTCUTS.editPage.accelerator),
    duplicate: chord("CmdOrCtrl+D"),
    italic: chord("CmdOrCtrl+I"),
    link: chord("CmdOrCtrl+K"),
    moveDown: chord("Alt+Down"),
    moveUp: chord("Alt+Up"),
    newLine: chord("Shift+Enter"),
    redo: chord("CmdOrCtrl+Shift+Z"),
    selectParent: chord("CmdOrCtrl+Up"),
    /** Return or Enter on its own: add an ask, start editing, finish an edit. */
    submit: chord("Enter"),
    undo: chord("CmdOrCtrl+Z"),
  };
}
