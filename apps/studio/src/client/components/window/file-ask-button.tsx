import { InstrumentGlyph } from "@/client/components/wordmark";
import { useContext } from "react";

import { WindowContext } from "./context";

/**
 * Ask, among a file tab's actions: a new draft about the file, with the file
 * chosen for it. Ask rather than a new chat, since what is asked may be a
 * change, a question, or anything else. Quiet like the row's other buttons,
 * the mark saying who it asks. Absent where no draft can open, as inside one.
 */
export function FileAskButton({ name, path }: { name: string; path: string }) {
  const askAbout = useContext(WindowContext)?.askAbout;
  if (!askAbout) {
    return null;
  }
  return (
    <button
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground/70 outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:[outline-style:solid] @max-xl/tabrow:px-1.5"
      onClick={() => {
        askAbout([{ kind: "file", path }]);
      }}
      title={`Ask about “${name}”`}
      type="button"
    >
      <InstrumentGlyph className="size-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
      {/* Only the mark in a narrow row; the name stays for a screen reader. */}
      <span className="@max-xl/tabrow:sr-only">Ask</span>
    </button>
  );
}
