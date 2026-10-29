import { highlightLoaded, syntaxLanguage } from "@/shared/syntax-highlight";
import { noop } from "radashi";
import { useEffect, useState } from "react";

// Highlighting injects a per-token DOM node for every line at once, so its
// cost scales with input size; large inputs (e.g. a 50k-row generated CSV)
// freeze the view. Past this size we skip highlighting, leaving the caller's
// plain-text rendering.
const MAX_SYNTAX_HIGHLIGHT_CHARS = 512 * 1024;

/**
 * The code as highlighted markup lines (`shared/syntax-highlight.ts`), drawn
 * in this window as it renders. A language's grammar loads the first time it
 * is asked for; until then, and for a language with no grammar, there is no
 * markup and the caller shows the code as plain text.
 */
export function useSyntaxHighlighting({
  code,
  language,
}: {
  code: string | undefined;
  language: string | undefined;
}) {
  const description = syntaxLanguage(language);
  const highlightableCode =
    code && code.length <= MAX_SYNTAX_HIGHLIGHT_CHARS ? code : undefined;
  const [loaded, setLoaded] = useState<string>();
  const isLoaded =
    description !== undefined &&
    (loaded === description.name || description.support !== undefined);

  useEffect(() => {
    if (!description || description.support) {
      return;
    }
    let live = true;
    // A grammar that fails to load leaves the text plain.
    description
      .load()
      .then(() => {
        if (live) {
          setLoaded(description.name);
        }
      })
      .catch(noop);
    return () => {
      live = false;
    };
  }, [description]);

  return {
    highlightedHtml:
      description && isLoaded && highlightableCode
        ? highlightLoaded(highlightableCode, description)
        : undefined,
    /** Whether highlighted output is coming, so callers can hold a fallback. */
    isHighlightable: !!description && !!highlightableCode,
    isLanguageSupported: !!description,
  };
}
