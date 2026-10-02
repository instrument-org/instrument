import { AGENT_NEEDS_LANGUAGE } from "../constants";

/**
 * A ```needs fence in a message, its body captured. Global, so a message with
 * several fences yields each.
 */
const NEEDS_FENCE = new RegExp(
  String.raw`^[ \t]*\x60{3,}[ \t]*${AGENT_NEEDS_LANGUAGE}[ \t]*$([\s\S]*?)^[ \t]*\x60{3,}[ \t]*$`,
  "gmu",
);

// Bullets and numbers an agent adds when it reads the block as a list.
const LIST_MARKER = /^(?:[*+-]|\d+[.)])\s+/;

/**
 * What a task says it cannot go on without: the lines of the needs fences in
 * its message, each once, in order, with list markers dropped. One need per
 * line (`folder: Desktop, to save the file there`), read as written: the kind
 * before the colon is for the reader, not a key anything switches on.
 */
export function needsNamedIn(text: string): string[] {
  const needs: string[] = [];
  for (const match of text.matchAll(NEEDS_FENCE)) {
    for (const line of (match[1] ?? "").split("\n")) {
      const need = line.trim().replace(LIST_MARKER, "").trim();
      if (need !== "" && !needs.includes(need)) {
        needs.push(need);
      }
    }
  }
  return needs;
}

/** The text with its needs fences taken out, for a reader that lists the needs apart. */
export function withoutNeedsFences(text: string): string {
  return text
    .replaceAll(NEEDS_FENCE, "")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}
