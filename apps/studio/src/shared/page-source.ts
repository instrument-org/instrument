import MagicString from "magic-string";
import { type DefaultTreeAdapterTypes, parse } from "parse5";

/** One element the file itself writes, with where its tags and attributes sit in the text. */
export interface PageSourceEntry {
  /** Its ordinal in document order, which is the id stamped on the element the page draws. */
  id: number;
  loc: ElementLocation;
  node: Element;
  tag: string;
}
type Element = DefaultTreeAdapterTypes.Element;

type ElementLocation = NonNullable<Element["sourceCodeLocation"]>;

/**
 * The elements of an HTML file that come from its own markup, in document
 * order. An element the parser implied (a `<tbody>` nobody wrote, a copy the
 * adoption agency made) has no start tag of its own at its offset and is left
 * out, and so is everything inside a `<template>`, whose content a script
 * clones: a clone then reads as something a script made, which it is.
 *
 * Ids are ordinals, so an edit that changes only text keeps every id pointing
 * at the same element after a re-parse.
 */
export function indexPageSource(src: string) {
  const tree = parse(src, { sourceCodeLocationInfo: true });
  const entries: PageSourceEntry[] = [];
  const walk = (node: DefaultTreeAdapterTypes.ParentNode) => {
    for (const child of node.childNodes) {
      if (!("tagName" in child)) {
        continue;
      }
      const loc = child.sourceCodeLocation;
      const start = loc?.startTag?.startOffset;
      if (
        loc &&
        start !== undefined &&
        src[start] === "<" &&
        src.slice(start + 1, start + 1 + child.tagName.length).toLowerCase() ===
          child.tagName.toLowerCase()
      ) {
        entries.push({
          id: entries.length,
          loc,
          node: child,
          tag: child.tagName,
        });
      }
      if (child.tagName !== "template") {
        walk(child);
      }
    }
  };
  walk(tree);
  return { entries, tree };
}

/**
 * The copy of a page an editor shows: the file's text with a `data-src-id` on
 * every element it writes, so an element on screen names the markup it came
 * from. Only this copy carries the ids; the file on disk never does.
 */
export function stampPageSource(src: string) {
  const stamped = new MagicString(src);
  for (const entry of indexPageSource(src).entries) {
    const { startTag } = entry.loc;
    if (startTag) {
      stamped.appendLeft(
        startTag.startOffset + 1 + entry.tag.length,
        ` data-src-id="${entry.id}"`,
      );
    }
  }
  return stamped.toString();
}
