import {
  getFaviconUrl,
  markIconlessThisSession,
} from "@/client/lib/favicon-url";
import { isWebPage } from "@/client/lib/open-target";
import { splitLinks } from "@/shared/link-text";
import { type Node as ProseMirrorNode } from "prosemirror-model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { linkOfNode, promptSchema } from "./prompt-editor-model";

// Links in the reply box, drawn the way the sent message will draw them: the
// site's icon in front and the words underlined. An address typed on its own
// stays plain text and is found where it stands; words someone linked carry
// the link mark. Nothing here asks any page for anything: the icon is the
// app's own copy, kept per site.

/** One link in the document: where it is, where it goes, and whether its words are its own. */
export interface PromptLink {
  from: number;
  href: string;
  /** Linked words (the link mark), rather than an address written out. */
  labeled: boolean;
  to: number;
}

interface LinksState {
  links: PromptLink[];
  /**
   * Where the caret stood after the last keystroke, while an address is
   * being typed there. An address that ends at it is still being written,
   * and is drawn once the person moves past it: a space, a click, an arrow.
   */
  typingAt: number | null;
}

export const promptLinksKey = new PluginKey<LinksState>("prompt-links");

/** A web address on its own, as a paste over selected words links them to. */
const URL_ONLY = /^https?:\/\/\S+$/i;

export function promptLinksPlugin() {
  return new Plugin<LinksState>({
    key: promptLinksKey,
    state: {
      init: (_config, state) => ({
        links: linksIn(state.doc),
        typingAt: null,
      }),
      apply: (tr, previous, _old, state) => {
        const links = tr.docChanged ? linksIn(state.doc) : previous.links;
        return {
          links,
          typingAt:
            tr.docChanged && isTyping(tr) && state.selection.empty
              ? state.selection.head
              : null,
        };
      },
    },
    props: {
      decorations(state) {
        const decorations = drawnLinks(state).flatMap((link) => [
          Decoration.inline(link.from, link.to, { class: "prompt-link" }),
          ...(isWebPage(link.href)
            ? [
                Decoration.widget(link.from, () => siteIcon(link.href), {
                  ignoreSelection: true,
                  key: `site-icon-${getFaviconUrl(link.href)}`,
                  side: -1,
                }),
              ]
            : []),
        ]);
        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : null;
      },
    },
  });
}

/** The links drawn as links: every one but an address still being typed. */
function drawnLinks(state: EditorState): PromptLink[] {
  const pluginState = promptLinksKey.getState(state);
  if (!pluginState) {
    return [];
  }
  const { links, typingAt } = pluginState;
  return links.filter((link) => link.labeled || link.to !== typingAt);
}

/** The drawn link the caret sits in, for the bar that acts on it. */
export function linkAtCaret(state: EditorState): PromptLink | undefined {
  const { empty, head } = state.selection;
  if (!empty) {
    return undefined;
  }
  return drawnLinks(state).find((link) => link.from <= head && head <= link.to);
}

/** The drawn link at a document position, for a Cmd-click. */
export function linkAtPos(
  state: EditorState,
  pos: number,
): PromptLink | undefined {
  return drawnLinks(state).find((link) => link.from <= pos && pos < link.to);
}

/**
 * A web address pasted over selected words links them, as in the Markdown
 * editor, rather than replacing them. Only within one line and only over
 * text: a chip in the selection has no words to link.
 */
export function linkSelectionToPasted(
  state: EditorState,
  text: string,
): Transaction | null {
  const { $from, $to, empty, from, to } = state.selection;
  const href = text.trim();
  if (empty || !URL_ONLY.test(href) || !$from.sameParent($to)) {
    return null;
  }
  let onlyText = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !node.isText) {
      onlyText = false;
    }
  });
  if (!onlyText) {
    return null;
  }
  return state.tr.addMark(from, to, promptSchema.marks.link.create({ href }));
}

/** Points linked words somewhere else, or an address written out at another. */
export function setLinkHref(
  state: EditorState,
  link: PromptLink,
  href: string,
): Transaction {
  return link.labeled
    ? state.tr
        .removeMark(link.from, link.to, promptSchema.marks.link)
        .addMark(link.from, link.to, promptSchema.marks.link.create({ href }))
    : state.tr.insertText(href, link.from, link.to);
}

/** Linked words become plain words; an address written out is taken out. */
export function removeLink(state: EditorState, link: PromptLink): Transaction {
  return link.labeled
    ? state.tr.removeMark(link.from, link.to, promptSchema.marks.link)
    : state.tr.delete(link.from, link.to);
}

/** Where on screen a link starts, for placing its bar. */
export function linkRect(view: EditorView, link: PromptLink) {
  const start = view.coordsAtPos(link.from, 1);
  return { bottom: start.bottom, left: start.left, top: start.top };
}

/**
 * Every link in the document. Linked words are found by their mark; an
 * address written out is found the way the sent message finds one
 * (`splitLinks`), so the box and the message agree on where it ends.
 */
function linksIn(doc: ProseMirrorNode): PromptLink[] {
  const links: PromptLink[] = [];
  doc.forEach((paragraph, offset) => {
    const start = offset + 1;
    // The line as text the bare-address pass can read, one character per
    // position: a chip and linked words read as spaces, which end an address.
    let line = "";
    paragraph.forEach((node, nodeOffset) => {
      const href = linkOfNode(node);
      if (href !== undefined) {
        const from = start + nodeOffset;
        const last = links.at(-1);
        if (last?.labeled && last.to === from && last.href === href) {
          last.to = from + node.nodeSize;
        } else {
          links.push({ from, href, labeled: true, to: from + node.nodeSize });
        }
      }
      line +=
        node.isText && href === undefined
          ? (node.text ?? "")
          : " ".repeat(node.nodeSize);
    });
    let at = 0;
    for (const segment of splitLinks(line)) {
      const length =
        segment.type === "text" ? segment.text.length : segment.label.length;
      if (segment.type === "link" && isWebPage(segment.href)) {
        links.push({
          from: start + at,
          href: segment.href,
          labeled: false,
          to: start + at + length,
        });
      }
      at += length;
    }
  });
  return links.sort((a, b) => a.from - b.from);
}

/** A keystroke, rather than a paste, a drop, an undo or a write from outside. */
function isTyping(tr: Transaction) {
  return (
    tr.getMeta("paste") === undefined &&
    tr.getMeta("uiEvent") === undefined &&
    tr.getMeta("history$") === undefined &&
    tr.steps.length === 1
  );
}

/**
 * A site's icon in front of a link to it, shown once it has loaded, so a
 * site with none, or one still being looked up, leaves no gap in the line.
 */
function siteIcon(href: string) {
  const img = document.createElement("img");
  img.className = "prompt-site-icon";
  img.alt = "";
  img.draggable = false;
  img.hidden = true;
  img.addEventListener("load", () => {
    img.hidden = false;
  });
  img.addEventListener("error", () => {
    markIconlessThisSession(href);
  });
  img.src = getFaviconUrl(href);
  return img;
}
