import { resolveFileTypeIcon } from "@/client/components/extend/file-system";
import { folderGlyphUrl } from "@/client/components/icons/folder-glyph";
import { findPaths, pathToQuote } from "@/client/lib/path-text";
import { typedFileName } from "@/client/lib/typed-path";
import { rpcClient } from "@/client/rpc/client";
import { expandHomePath } from "@instrument-org/shared";
import { keymap } from "prosemirror-keymap";
import { type Node as ProseMirrorNode } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/** What every path in the draft is drawn with, under its words. */
const PATH_CLASS_NAME =
  "rounded-r-sm bg-muted py-px pr-0.5 box-decoration-clone";

/** The box in front of a path holding its icon, in the same tint, so the two read as one. */
const PATH_ICON_SLOT_CLASS_NAME =
  "pointer-events-none rounded-l-sm bg-muted py-px pr-1 pl-0.5 select-none";

/** The icon itself, sized and set on the line like a chip's. */
const PATH_ICON_CLASS_NAME =
  "inline-block size-3 align-[-1px] text-muted-foreground";

/**
 * A quote beside a path, there to edit and to send but taking no room. Text
 * of no size rather than no text, so the caret still has a place on each side
 * of it and what is typed there lands where it reads.
 */
const PATH_QUOTE_CLASS_NAME = "text-[0px]";

// What a token stands as in a paragraph's text, one position wide like the
// token itself, so an offset in the text is an offset in the paragraph.
const TOKEN_STAND_IN = "￼";

const pathsKey = new PluginKey<DecorationSet>("paths");

/**
 * Paths on this computer written into the draft, each tinted with its file
 * or folder icon in front, the way the sent message will show it as a chip.
 *
 * Only drawn: the words stay the words, to edit, select and undo like any
 * other, and what is sent is what was typed or pasted, with the quotes
 * {@link dispatchPaste} puts around a real path. Read again on every edit, so
 * a path stops being drawn as one the moment it stops reading as one.
 */
export const pathsPlugin = (platform: string) =>
  new Plugin<DecorationSet>({
    appendTransaction: (transactions, _previous, state) =>
      transactions.some((tr) => tr.getMeta("pointer") === true)
        ? caretOutsidePathQuote(state)
        : undefined,
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
    for (const { from, path, quoted, to } of findPaths(text, platform)) {
      const fileName = typedFileName(path);
      if (quoted) {
        const attributes = {
          class: PATH_QUOTE_CLASS_NAME,
          "data-path-quote": "",
        };
        decorations.push(
          Decoration.inline(start + from - 1, start + from, attributes, {
            pathQuote: "open",
          }),
          Decoration.inline(start + to, start + to + 1, attributes, {
            pathQuote: "close",
          }),
        );
      }
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

/** Which quote beside a path starts at a position, if one does. */
function pathQuoteAt(state: EditorState, from: number) {
  const quote = pathsKey
    .getState(state)
    ?.find(
      from,
      from + 1,
      (spec: { pathQuote?: "close" | "open" }) => spec.pathQuote !== undefined,
    )
    .find((found) => found.from === from);
  // A decoration's spec is `any`; this plugin alone sets `pathQuote` on one.
  return (quote?.spec as undefined | { pathQuote?: "close" | "open" })
    ?.pathQuote;
}

/**
 * Where a click beside a path puts the caret, which reads the same on either
 * side of a quote: outside it, so what is typed next goes beside the path.
 */
function caretOutsidePathQuote(state: EditorState) {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor) {
    return;
  }
  const { pos } = $cursor;
  const outside =
    pathQuoteAt(state, pos - 1) === "open"
      ? pos - 1
      : pathQuoteAt(state, pos) === "close"
        ? pos + 1
        : undefined;
  return outside === undefined
    ? undefined
    : state.tr.setSelection(TextSelection.create(state.doc, outside));
}

/**
 * A key that moves or deletes by a letter treats a quote beside a path as not
 * there: the caret steps past it first and the key goes on to do what it does,
 * so the quotes stay on when a path is edited and take no extra press to cross.
 */
const stepOverPathQuote =
  (direction: -1 | 1): Command =>
  (state, dispatch) => {
    const { $cursor } = state.selection as TextSelection;
    if (!$cursor) {
      return false;
    }
    if (pathQuoteAt(state, direction < 0 ? $cursor.pos - 1 : $cursor.pos)) {
      dispatch?.(
        state.tr.setSelection(
          TextSelection.create(state.doc, $cursor.pos + direction),
        ),
      );
    }
    return false;
  };

/** Sits ahead of the editor's own keys, which it hands every press on to. */
export const pathQuoteKeys = () =>
  keymap({
    ArrowLeft: stepOverPathQuote(-1),
    ArrowRight: stepOverPathQuote(1),
    Backspace: stepOverPathQuote(-1),
    Delete: stepOverPathQuote(1),
    // Deleting a word: Option on a Mac, Control elsewhere.
    "Alt-Backspace": stepOverPathQuote(-1),
    "Alt-Delete": stepOverPathQuote(1),
    "Ctrl-Backspace": stepOverPathQuote(-1),
    "Ctrl-Delete": stepOverPathQuote(1),
  });

/** How long the disk gets to answer about a pasted path before the paste stays as it is. */
const PASTED_PATH_LOOK_MS = 2000;

/** A pasted path waiting on the disk's answer, followed through the edits made meanwhile. */
interface PastedPath {
  from: number;
  id: number;
  text: string;
  /** When it was pasted, the undo history's clock included. */
  time: number;
  to: number;
}

const pastedPathsKey = new PluginKey<PastedPath[]>("pasted-paths");

/** Where the pasted paths still waiting on the disk are in the document. */
export const pastedPathsPlugin = () =>
  new Plugin<PastedPath[]>({
    key: pastedPathsKey,
    state: {
      apply: (tr, pending) => {
        // Written only by the two calls below.
        const meta = tr.getMeta(pastedPathsKey) as
          | { add?: PastedPath; settled?: number }
          | undefined;
        const mapped = pending
          .filter(({ id }) => id !== meta?.settled)
          .map((pasted) => ({
            ...pasted,
            // Words typed against either end stay outside it.
            from: tr.mapping.map(pasted.from, 1),
            to: tr.mapping.map(pasted.to, -1),
          }));
        return meta?.add ? [...mapped, meta.add] : mapped;
      },
      init: () => [],
    },
  });

let lastPastedPathId = 0;

/**
 * Put a paste in right away and, when its words read as a path only quotes
 * can keep whole, ask the disk once whether it is there. A real file or
 * folder gets its quotes, in the same undo step as the paste, so whatever is
 * written after it stays out of the path here and in the sent message. No
 * answer, or a slow one, leaves the words as pasted.
 *
 * `files.missing` rather than `computer.locate`, which opens the folders
 * above a missing path, and a listing in a folder macOS protects is what
 * raises the system's prompt.
 */
export function dispatchPaste(view: EditorView, tr: Transaction, text: string) {
  const path = pathToQuote(text, window.electron.process.platform);
  if (!path) {
    view.dispatch(tr);
    return;
  }
  const id = (lastPastedPathId += 1);
  const to = tr.selection.to;
  view.dispatch(
    tr.setMeta(pastedPathsKey, {
      add: { from: to - text.length, id, text, time: tr.time, to },
    }),
  );
  const answer = (isThere: boolean) => {
    if (!view.isDestroyed) {
      settlePastedPath(view, id, isThere);
    }
  };
  rpcClient.files.missing
    .call({ paths: [expandHomePath(path.shown, window.api.homeDir)] })
    .then(({ missing }) => {
      answer(missing.length === 0);
    })
    .catch(() => {
      answer(false);
    });
}

/** Stop waiting on a pasted path, quoting it when it is there and its words are unchanged. */
function settlePastedPath(view: EditorView, id: number, isThere: boolean) {
  const pasted = pastedPathsKey
    .getState(view.state)
    ?.find((candidate) => candidate.id === id);
  if (!pasted) {
    return;
  }
  const tr = view.state.tr.setMeta(pastedPathsKey, { settled: id });
  if (
    isThere &&
    Date.now() - pasted.time <= PASTED_PATH_LOOK_MS &&
    quotesFind(tr.doc, pasted)
  ) {
    tr.insertText('"', pasted.to)
      .insertText('"', pasted.from)
      // The paste's own time, which is how the history takes a step this
      // much later as part of the paste.
      .setTime(pasted.time);
  }
  view.dispatch(tr);
}

/** Whether the pasted words are still in their place, and read as a path once quoted. */
function quotesFind(doc: ProseMirrorNode, { from, text, to }: PastedPath) {
  if (from >= to) {
    return false;
  }
  const $from = doc.resolve(from);
  if (!$from.sameParent(doc.resolve(to))) {
    return false;
  }
  const paragraph = $from.parent;
  const line = paragraph.textBetween(
    0,
    paragraph.content.size,
    undefined,
    TOKEN_STAND_IN,
  );
  const at = $from.parentOffset;
  const end = at + to - from;
  if (line.slice(at, end) !== text) {
    return false;
  }
  const quoted = `${line.slice(0, at)}"${text}"${line.slice(end)}`;
  return findPaths(quoted, window.electron.process.platform).some(
    (found) => found.quoted && found.from === at + 1 && found.to === end + 1,
  );
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
