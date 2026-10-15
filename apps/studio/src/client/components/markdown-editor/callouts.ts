import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { type Ctx } from "@milkdown/kit/ctx";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { icon, type IconName } from "./icons";

// GitHub's callouts: a quote whose first line is `[!NOTE]` (or TIP,
// IMPORTANT, WARNING, CAUTION) is drawn as a tinted box with the kind's
// icon and name in place of the marker. The marker stays text in the file
// and in the document; with the caret in it, it shows as written, so the
// kind is changed by typing another.

const KINDS = {
  caution: { icon: "warningOctagon", label: "Caution" },
  important: { icon: "chatCenteredText", label: "Important" },
  note: { icon: "info", label: "Note" },
  tip: { icon: "lightbulb", label: "Tip" },
  warning: { icon: "warning", label: "Warning" },
} satisfies Record<string, { icon: IconName; label: string }>;

type Kind = keyof typeof KINDS;

const MARKER = /^\[!(caution|important|note|tip|warning)\]/i;

/** The marker a slash-menu callout starts with. */
export const NEW_CALLOUT_MARKER = "[!NOTE]";

const isKind = (name: string): name is Kind => name in KINDS;

/** The callout a quote is, with where its marker stands, or none for a plain quote. */
function calloutOf(quote: PMNode, pos: number) {
  const paragraph = quote.firstChild;
  const text =
    paragraph?.type.name === "paragraph" ? paragraph.firstChild : null;
  const found = text?.isText ? MARKER.exec(text.text ?? "") : null;
  const kind = found?.[1]?.toLowerCase() ?? "";
  if (!found || !isKind(kind)) {
    return undefined;
  }
  // The quote opens, then its paragraph.
  const from = pos + 2;
  return { from, kind, to: from + found[0].length };
}

/**
 * Keeps a callout's marker as written when its quote is saved. Remark
 * escapes the `[` of any text that could start a link, which would turn
 * `[!NOTE]` into `\[!NOTE]` and the callout back into a plain quote.
 */
export function keepCalloutMarkers(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: {
      ...prev.handlers,
      text: (node, parent, state, info) => {
        const written =
          prev.handlers?.text?.(node, parent, state, info) ??
          state.safe(node.value, info);
        return parent?.type === "paragraph" &&
          parent.children[0] === node &&
          state.stack.includes("blockquote")
          ? written.replace(
              /^\\(\[!(?:caution|important|note|tip|warning)\])/i,
              "$1",
            )
          : written;
      },
    },
  }));
}

export const calloutsPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          const head = state.selection.head;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "blockquote") {
              return true;
            }
            const callout = calloutOf(node, pos);
            if (!callout) {
              return true;
            }
            const { from, kind, to } = callout;
            decos.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: "md-callout",
                "data-callout": kind,
              }),
            );
            if (head >= from && head <= to) {
              decos.push(
                Decoration.inline(from, to, { class: "md-callout-marker" }),
              );
            } else {
              decos.push(
                Decoration.inline(from, to, { class: "md-callout-hidden" }),
                Decoration.widget(
                  from,
                  (view) =>
                    label(kind, () => {
                      view.dispatch(
                        view.state.tr.setSelection(
                          TextSelection.create(view.state.doc, to),
                        ),
                      );
                      view.focus();
                    }),
                  { key: `callout-${kind}`, side: -1 },
                ),
              );
            }
            return true;
          });
          return decos.length > 0
            ? DecorationSet.create(state.doc, decos)
            : null;
        },
      },
    }),
);

/** The kind's icon and name, drawn where the marker is; a click shows the marker to edit. */
function label(kind: Kind, onClick: () => void) {
  const el = document.createElement("span");
  el.className = "md-callout-label";
  el.contentEditable = "false";
  el.innerHTML = `${icon(KINDS[kind].icon, 16)}<span>${KINDS[kind].label}</span>`;
  el.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onClick();
  });
  return el;
}
