import { resolveFileTypeIcon } from "@/client/components/extend/file-system";
import { folderGlyphUrl } from "@/client/components/icons/folder-glyph";
import { findPaths } from "@/client/lib/path-text";
import { typedFileName } from "@/client/lib/typed-path";
import { type Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** What every path in the draft is drawn with, under its words. */
const PATH_CLASS_NAME =
  "rounded-r-sm bg-muted py-px pr-0.5 box-decoration-clone";

/** The box in front of a path holding its icon, in the same tint, so the two read as one. */
const PATH_ICON_SLOT_CLASS_NAME =
  "pointer-events-none rounded-l-sm bg-muted py-px pr-1 pl-0.5 select-none";

/** The icon itself, sized and set on the line like a chip's. */
const PATH_ICON_CLASS_NAME =
  "inline-block size-3 align-[-1px] text-muted-foreground";

// What a token stands as in a paragraph's text, one position wide like the
// token itself, so an offset in the text is an offset in the paragraph.
const TOKEN_STAND_IN = "￼";

const pathsKey = new PluginKey<DecorationSet>("paths");

/**
 * Paths on this computer written into the draft, each tinted with its file
 * or folder icon in front, the way the sent message will show it as a chip.
 *
 * Only drawn: the words stay the words, to edit, select and undo like any
 * other, and what is sent is exactly what was typed or pasted. Read again on
 * every edit, so a path stops being drawn as one the moment it stops reading
 * as one.
 */
export const pathsPlugin = (platform: string) =>
  new Plugin<DecorationSet>({
    key: pathsKey,
    props: {
      decorations: (state) => pathsKey.getState(state),
    },
    state: {
      apply: (tr, previous) =>
        tr.docChanged ? pathDecorations(tr.doc, platform) : previous,
      init: (_config, state) => pathDecorations(state.doc, platform),
    },
  });

/** The decorations for every path the document's paragraphs name. */
export function pathDecorations(doc: ProseMirrorNode, platform: string) {
  const decorations: Decoration[] = [];
  doc.forEach((paragraph, offset) => {
    const text = paragraph.textBetween(
      0,
      paragraph.content.size,
      undefined,
      TOKEN_STAND_IN,
    );
    // Inside the paragraph, past its opening.
    const start = offset + 1;
    for (const { from, path, to } of findPaths(text, platform)) {
      const fileName = typedFileName(path);
      decorations.push(
        Decoration.widget(start + from, () => iconOf(fileName), {
          ignoreSelection: true,
          key: `path-icon:${fileName ?? "/"}`,
          side: -1,
        }),
        Decoration.inline(start + from, start + to, {
          class: PATH_CLASS_NAME,
          "data-path": "",
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/** The icon's box, which the caret and the pointer pass over. */
function iconOf(fileName: string | undefined) {
  const slot = document.createElement("span");
  slot.className = PATH_ICON_SLOT_CLASS_NAME;
  slot.append(glyphOf(fileName));
  return slot;
}

/** A file's icon from the sprite sheet, or the system's folder for a folder. */
function glyphOf(fileName: string | undefined): HTMLElement | SVGElement {
  if (fileName === undefined) {
    const image = document.createElement("img");
    image.alt = "";
    image.className = PATH_ICON_CLASS_NAME;
    image.draggable = false;
    image.src = folderGlyphUrl();
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  const icon = resolveFileTypeIcon(fileName);
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", PATH_ICON_CLASS_NAME);
  svg.setAttribute("viewBox", icon.viewBox ?? "0 0 16 16");
  if (icon.token) {
    svg.style.color = `var(--fs-file-icon-${icon.token}, var(--fs-file-icon-default))`;
  }
  const use = document.createElementNS(svgNamespace, "use");
  use.setAttribute("href", `#${icon.name}`);
  svg.append(use);
  return svg;
}
