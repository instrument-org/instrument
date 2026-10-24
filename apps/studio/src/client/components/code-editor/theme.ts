// How a code file looks in the editor: the same type, measure and colors as
// every view that only shows code, so a file reads the same whether it is
// being glanced at or edited. Tokens carry the shared `syntax-*` classes
// (shared/syntax-highlight.ts), colored by CSS variables in code-colors.css,
// so the theme follows the app's light and dark without a reconfigure.
import { syntaxClassHighlighter } from "@/shared/syntax-highlight";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const codeHighlighting = syntaxHighlighting(syntaxClassHighlighter);

/**
 * Property names take the color the GitHub themes give them in each language:
 * a key in a data file is a tag's green, a CSS property a constant's blue,
 * and a property in code the plain text color, which needs no rule.
 */
export function propertyColors(languageName: string) {
  const color = /^(?:json|yaml|toml)/i.test(languageName)
    ? "var(--cm-tag)"
    : /^(?:css|scss|sass|less)$/i.test(languageName)
      ? "var(--cm-constant)"
      : null;
  return color
    ? [
        {
          color,
          tag: [t.propertyName, t.definition(t.propertyName)],
        },
      ]
    : [];
}

/**
 * The editor's frame in Studio's tokens. Sizes are the code view's: 14px on a
 * 20px line in the app's monospace, a 16px inset, and line numbers set in the
 * same type as the text they count, a step quieter.
 */
export const studioEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--cm-foreground)",
    fontSize: "14px",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--cm-selection) !important" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-content": {
    caretColor: "var(--foreground)",
    fontFamily: "var(--cm-font)",
    lineHeight: "var(--cm-line-height)",
    padding: "var(--cm-inset-block) 0",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutterElement.cm-activeLineGutter": {
    color: "var(--muted-foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--cm-line-number)",
    fontFamily: "var(--cm-font)",
    lineHeight: "var(--cm-line-height)",
    paddingLeft: "8px",
  },
  ".cm-line": { padding: "0 var(--cm-inset-inline)" },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3ch",
    padding: "0 4px 0 8px",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--cm-bracket)",
    color: "inherit",
  },
  ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "var(--cm-font)",
    lineHeight: "var(--cm-line-height)",
    overflow: "auto",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--cm-search-match)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--cm-search-current)",
  },
  ".cm-tooltip.cm-ask-tooltip": {
    backgroundColor: "var(--popover)",
    border: "none",
    borderRadius: "calc(var(--radius) + 4px)",
    boxShadow: "var(--elevation-md)",
    padding: "4px",
  },
});
