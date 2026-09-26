import { useContext } from "react";

import { OrchestratorContext } from "./context";
import { GlyphButton } from "./glyph-button";

/**
 * Ask, at the head of a file tab's actions: a new draft about the file, with
 * the file chosen for it. Ask rather than a new chat, since what is asked may
 * be a change, a question, or anything else. Absent where no draft can open,
 * as inside one.
 */
export function FileAskButton({ name, path }: { name: string; path: string }) {
  const askAbout = useContext(OrchestratorContext)?.askAbout;
  if (!askAbout) {
    return null;
  }
  return (
    <GlyphButton
      className="mr-1 h-7 shrink-0 @max-xl/tabrow:gap-0 @max-xl/tabrow:px-2"
      onClick={() => {
        askAbout([{ kind: "file", path }]);
      }}
      size="sm"
      title={`Ask about “${name}”`}
    >
      {/* Only the mark in a narrow row; the name stays for a screen reader. */}
      <span className="@max-xl/tabrow:sr-only">Ask</span>
    </GlyphButton>
  );
}
