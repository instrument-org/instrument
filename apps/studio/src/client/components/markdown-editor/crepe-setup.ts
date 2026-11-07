// What every Markdown editor in Studio sets up on Crepe alike, whether it
// edits a file (editor-session.ts) or a value a form saves (value-session.ts):
// the icons its menus wear, how it writes Markdown back, and the decoration
// the stylesheet lays out the caret's blocks by.
import { codeHighlighting } from "@/client/components/code-editor/theme";
import { type Crepe } from "@milkdown/crepe";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { keepCalloutMarkers } from "./callouts";
import { languages } from "./code-blocks";
import { icon } from "./icons";

/** The block menu's icons: the gutter's + and grip, and every item of the slash menu. */
export const BLOCK_EDIT_ICONS = {
  advancedGroup: {
    codeBlock: { icon: icon("code", 16) },
    math: { icon: icon("sigma", 16) },
    table: { icon: icon("table", 16) },
  },
  handleAddIcon: icon("plus", 14),
  handleDragIcon: icon("dotsSixVertical", 14),
  listGroup: {
    bulletList: { icon: icon("listBullets", 16) },
    orderedList: { icon: icon("listNumbers", 16) },
    taskList: { icon: icon("listChecks", 16) },
  },
  textGroup: {
    divider: { icon: icon("minus", 16) },
    h1: { icon: icon("textHOne", 16) },
    h2: { icon: icon("textHTwo", 16) },
    h3: { icon: icon("textHThree", 16) },
    h4: { icon: icon("textHFour", 16) },
    h5: { icon: icon("textHFive", 16) },
    h6: { icon: icon("textHSix", 16) },
    quote: { icon: icon("quotes", 16) },
    text: { icon: icon("textT", 16) },
  },
};

/** A code block's controls and highlighting. */
export const CODE_MIRROR_SETUP = {
  clearSearchIcon: icon("x", 12),
  copyIcon: icon("copy", 12),
  expandIcon: icon("caretDown", 10),
  languages,
  searchIcon: icon("magnifyingGlass", 14),
  theme: codeHighlighting,
};

export const LINK_TOOLTIP_ICONS = {
  confirmButton: icon("check", 14),
  editButton: icon("pencilSimple", 14),
  linkIcon: icon("link", 14),
  removeButton: icon("linkBreak", 14),
};

export const TABLE_ICONS = {
  addColIcon: icon("plus", 12),
  addRowIcon: icon("plus", 12),
  alignCenterIcon: icon("textAlignCenter", 14),
  alignLeftIcon: icon("textAlignLeft", 14),
  alignRightIcon: icon("textAlignRight", 14),
  colDragHandleIcon: icon("dotsSix", 14),
  deleteColIcon: icon("trash", 14),
  deleteRowIcon: icon("trash", 14),
  rowDragHandleIcon: icon("dotsSixVertical", 14),
};

/** The selection toolbar's formatting icons. */
export const TOOLBAR_ICONS = {
  boldIcon: icon("textB", 16),
  codeIcon: icon("code", 16),
  italicIcon: icon("textItalic", 16),
  latexIcon: icon("sigma", 16),
  linkIcon: icon("link", 16),
  strikethroughIcon: icon("textStrikethrough", 16),
};

/** How the editor reads and writes Markdown, the same in every editor so a file reads back as it was written. */
export function configureMarkdown(editor: Crepe) {
  // Studio treats only `$$`, ```math and the like as math; `$42,000` is money.
  editor.editor.config((ctx) => {
    ctx.set("remarkMath", { singleDollarTextMath: false });
  });
  editor.editor.config(keepCalloutMarkers);
  // Serialized lists and rules use `-`, the marker most Markdown in the wild (and the agent) writes.
  editor.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({
      ...prev,
      bullet: "-" as const,
      rule: "-" as const,
    }));
  });
}

/** Marks the top-level blocks around the caret, which the stylesheet always lays out. */
export const nearCaretPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const { doc, selection } = state;
          const $head = selection.$head;
          if ($head.depth === 0) {
            return null;
          }
          // The caret's block and one on either side, found from the
          // caret rather than by walking a document of thousands of blocks.
          const index = $head.index(0);
          const at = $head.before(1);
          const current = doc.child(index);
          const decos = [
            Decoration.node(at, at + current.nodeSize, {
              class: "md-near-caret",
            }),
          ];
          if (index > 0) {
            const before = doc.child(index - 1);
            decos.push(
              Decoration.node(at - before.nodeSize, at, {
                class: "md-near-caret",
              }),
            );
          }
          if (index + 1 < doc.childCount) {
            const after = doc.child(index + 1);
            const from = at + current.nodeSize;
            decos.push(
              Decoration.node(from, from + after.nodeSize, {
                class: "md-near-caret",
              }),
            );
          }
          return DecorationSet.create(doc, decos);
        },
      },
    }),
);
