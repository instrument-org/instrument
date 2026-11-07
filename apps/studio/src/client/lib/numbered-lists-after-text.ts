/**
 * Opens a blank line above a numbered list written directly under a line of
 * text, so it reads as the list it was written as.
 *
 * CommonMark lets a numbered list interrupt a paragraph only when it starts
 * at 1, so that a sentence wrapped at a number ("ships in\n2026. Then") does
 * not become a list. A model numbering its items across sections writes a
 * bold line and then "6. ..." under it, and the parser reads every item as
 * more of the bold line's paragraph, which `remark-breaks` then draws as one
 * line each: numbers in the prose rather than a list.
 *
 * A marker of one to three digits is taken as a list, so a year at the start
 * of a wrapped line still reads as prose. Fenced code, block quotes, and a
 * line under a list item or its indented continuation are left alone: the
 * first two mean something else, and the last is already in a list.
 */

const ORDERED_ITEM = /^ {0,3}\d{1,3}[.)][ \t]+\S/;
const ANY_ITEM = /^ {0,3}(?:\d{1,9}[.)]|[-*+])(?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function numberedListsAfterText(markdown: string): string {
  if (!/\n {0,3}\d{1,3}[.)][ \t]/.test(markdown)) {
    return markdown;
  }
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | undefined;
  // Whether the line before is part of a list item: the item itself, or a
  // line continuing it, until a blank line ends the run.
  let inItem = false;
  for (const line of lines) {
    const fenceMark = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      if (
        fenceMark !== undefined &&
        fenceMark[0] === fence[0] &&
        fenceMark.length >= fence.length
      ) {
        fence = undefined;
      }
      out.push(line);
      continue;
    }
    if (fenceMark !== undefined) {
      fence = fenceMark;
      inItem = false;
      out.push(line);
      continue;
    }
    const previous = out.at(-1);
    if (
      ORDERED_ITEM.test(line) &&
      previous !== undefined &&
      previous.trim() !== "" &&
      !inItem &&
      !/^ {0,3}>/.test(previous) &&
      !/^ {0,3}\|/.test(previous)
    ) {
      out.push("");
    }
    if (line.trim() === "") {
      inItem = false;
    } else if (ANY_ITEM.test(line)) {
      inItem = true;
    }
    out.push(line);
  }
  return out.join("\n");
}
