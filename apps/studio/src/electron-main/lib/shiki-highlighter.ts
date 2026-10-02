import { type HighlighterCore } from "shiki";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

let highlighterInstance: HighlighterCore | null = null;
let highlighterPromise: null | Promise<HighlighterCore> = null;

/** The one highlighter the main process shares, its languages loaded as asked for. */
export async function getHighlighter() {
  if (highlighterInstance !== null) {
    return highlighterInstance;
  }

  // Use createHighlighterCore with JS RegExp engine instead of WASM to eliminate initialization overhead and UI freezing.
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: [],
    // Dynamic imports delay loading theme bundles until highlighter is actually used.
    themes: [
      import("shiki/themes/github-dark-default.mjs"),
      import("shiki/themes/github-light-default.mjs"),
    ],
  });

  highlighterInstance = await highlighterPromise;
  return highlighterInstance;
}
