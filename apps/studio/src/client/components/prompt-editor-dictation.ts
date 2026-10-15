import { type EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * What the editor shows around dictation: while someone dictates, a mark at
 * the end of the words where theirs will land, and once they land, a wash
 * over them that fades, so the eye finds where they went.
 */
type DictationState = {
  dictating: boolean;
  landed?: { from: number; to: number };
};

export const dictationKey = new PluginKey<DictationState>("dictation");

/** How long the wash over landed words lasts; the CSS animation matches it. */
export const DICTATION_LANDED_MS = 1600;

export const dictationPlugin = () =>
  new Plugin<DictationState>({
    key: dictationKey,
    props: {
      decorations: (state) => decorationsOf(state),
    },
    state: {
      apply: (tr, previous) => {
        const meta = tr.getMeta(dictationKey) as
          | Partial<DictationState>
          | undefined;
        const landed = previous.landed && {
          from: tr.mapping.map(previous.landed.from, 1),
          to: tr.mapping.map(previous.landed.to, -1),
        };
        return {
          dictating: previous.dictating,
          ...(landed && landed.to > landed.from && { landed }),
          ...meta,
        };
      },
      init: () => ({ dictating: false }),
    },
  });

function decorationsOf(state: EditorState) {
  const { dictating, landed } = dictationKey.getState(state) ?? {
    dictating: false,
  };
  const decorations: Decoration[] = [];
  if (dictating) {
    // The end of the last paragraph, where appended words begin.
    decorations.push(
      Decoration.widget(
        state.doc.content.size - 1,
        () => {
          const caret = document.createElement("span");
          caret.className = "dictation-landing";
          caret.setAttribute("aria-hidden", "true");
          return caret;
        },
        { key: "dictation-landing", side: 1 },
      ),
    );
  }
  if (landed) {
    decorations.push(
      Decoration.inline(landed.from, landed.to, { class: "dictation-landed" }),
    );
  }
  return decorations.length
    ? DecorationSet.create(state.doc, decorations)
    : DecorationSet.empty;
}
