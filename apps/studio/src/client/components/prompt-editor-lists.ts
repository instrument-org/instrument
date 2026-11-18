import { type Node as ProseMirrorNode } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

// Lists in the reply box, kept as the text they are: a line starting with
// `- `, `* `, `• ` or `1. ` is a list item, and the box only helps write one.
// A new line carries the marker on, a line left with only its marker ends the
// list, and a wrapped item lines up under its first word rather than under
// the marker. What is sent is exactly what was typed.

/** A list item's marker at the start of a line: its indent, the marker, and the space after it. */
const MARKER = /^( *)(?:([-*•])|(\d{1,3})([.)]))( +)/u;

/** How far a Tab moves a list item in. */
const INDENT = "  ";

interface ListLine {
  /** The marker as written, indent and trailing space included. */
  marker: string;
  /** The marker the next line takes: the same bullet, or the next number. */
  next: string;
  /** Where the line's paragraph starts its content. */
  start: number;
}

/** The list item a paragraph is, if its first words are a marker. */
function listLineOf(paragraph: ProseMirrorNode, start: number) {
  const first = paragraph.firstChild;
  const match = first?.isText ? MARKER.exec(first.text ?? "") : null;
  if (!match) {
    return undefined;
  }
  const [marker, indent = "", bullet, number, delimiter = ".", space = " "] =
    match;
  const next = bullet
    ? `${indent}${bullet}${space}`
    : `${indent}${Number(number) + 1}${delimiter}${space}`;
  return { marker, next, start } satisfies ListLine;
}

/** The list item the caret's line is, with the caret past its marker. */
function caretListLine(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph") {
    return undefined;
  }
  const line = listLineOf($from.parent, $from.start());
  return line && $from.pos >= line.start + line.marker.length
    ? line
    : undefined;
}

/**
 * Shift-Enter in a list item: the new line starts with the next marker, or,
 * on a line holding nothing but its marker, the marker goes and the list ends.
 */
export const continueList: Command = (state, dispatch) => {
  const line = caretListLine(state);
  if (!line) {
    return false;
  }
  const { $from } = state.selection;
  if ($from.parent.content.size === line.marker.length) {
    dispatch?.(state.tr.delete(line.start, line.start + line.marker.length));
    return true;
  }
  if (dispatch) {
    const tr = state.tr.split($from.pos);
    // Past the paragraph's close and the new one's open.
    const nextStart = $from.pos + 2;
    tr.insertText(line.next, nextStart);
    tr.setSelection(
      TextSelection.create(tr.doc, nextStart + line.next.length),
    ).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** Backspace just past a marker takes the whole marker out, keeping the indent. */
export const removeListMarker: Command = (state, dispatch) => {
  const line = caretListLine(state);
  if (!line || state.selection.from !== line.start + line.marker.length) {
    return false;
  }
  const indent = /^ */u.exec(line.marker)?.[0].length ?? 0;
  dispatch?.(
    state.tr.delete(line.start + indent, line.start + line.marker.length),
  );
  return true;
};

/**
 * Tab moves a list item in and Shift-Tab out. Off a list item the keys are
 * left to move focus, as they do anywhere else in the window.
 */
export const indentListItem =
  (direction: 1 | -1): Command =>
  (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.sameParent(state.selection.$to)) {
      return false;
    }
    const line = listLineOf($from.parent, $from.start());
    if (!line) {
      return false;
    }
    if (direction === 1) {
      dispatch?.(state.tr.insertText(INDENT, line.start));
      return true;
    }
    const indent = Math.min(
      INDENT.length,
      /^ */u.exec(line.marker)?.[0].length ?? 0,
    );
    if (indent > 0) {
      dispatch?.(state.tr.delete(line.start, line.start + indent));
    }
    return true;
  };

/** A line that is a carried-on marker followed by one typed by habit: `- - `, `2. 2. `. */
const DOUBLED_MARKER = /^( *(?:([-*•])|\d{1,3}([.)])) +)(?:\2|\d{1,3}\3) +$/u;

/**
 * Someone used to typing their own marker types one after the marker the box
 * already carried on, so the second is taken back, leaving the line as one
 * item ready for its words.
 */
function collapseTypedMarker(state: EditorState) {
  const { $from, empty } = state.selection;
  const first = $from.parent.firstChild;
  if (
    !empty ||
    $from.parent.childCount !== 1 ||
    !first?.isText ||
    $from.parentOffset !== first.nodeSize
  ) {
    return null;
  }
  const match = DOUBLED_MARKER.exec(first.text ?? "");
  if (!match?.[1]) {
    return null;
  }
  const start = $from.start();
  return state.tr.delete(start + match[1].length, $from.pos);
}

const listsKey = new PluginKey("prompt-lists");

/**
 * Draws each list item with a hanging indent the width of its marker, so a
 * wrapped item's later lines start under its first word. The width is
 * measured in the box's own font, so a `10. ` hangs further than a `- `.
 */
export function promptListsPlugin() {
  let measure: ((text: string) => number) | undefined;
  return new Plugin({
    key: listsKey,
    appendTransaction: (transactions, _old, state) =>
      transactions.some((tr) => tr.docChanged)
        ? collapseTypedMarker(state)
        : null,
    props: {
      decorations(state) {
        if (!measure) {
          return null;
        }
        const width = measure;
        const decorations: Decoration[] = [];
        state.doc.forEach((paragraph, offset) => {
          const line = listLineOf(paragraph, offset + 1);
          if (line) {
            decorations.push(
              Decoration.node(offset, offset + paragraph.nodeSize, {
                class: "prompt-list-line",
                style: `--prompt-hang: ${width(line.marker).toFixed(1)}px`,
              }),
            );
          }
        });
        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : null;
      },
    },
    view(view) {
      // A document with no canvas to measure with (a jsdom test) draws no
      // hanging indent, and asking it for one only logs that it has none.
      const context =
        typeof CanvasRenderingContext2D === "undefined"
          ? null
          : document.createElement("canvas").getContext("2d");
      if (context) {
        const style = getComputedStyle(view.dom);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        measure = (text) => context.measureText(text).width;
        // Drawn again now that there is something to measure with, once the
        // view is built: its owner's dispatch reads the view it is building.
        queueMicrotask(() => {
          if (!view.isDestroyed) {
            view.dispatch(view.state.tr.setMeta(listsKey, true));
          }
        });
      }
      return {};
    },
  });
}
