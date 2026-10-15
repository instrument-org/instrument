import { type EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * What the editor shows around dictation: while someone dictates, a mark at
 * the end of the words where theirs will land, with the words being heard
 * before it when the box shows them, and once they land, a wash over them
 * that fades, so the eye finds where they went.
 */
type DictationState = {
  dictating: boolean;
  landed?: { from: number; to: number };
  words?: { interim: string; settled: string };
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
          ...(previous.words && { words: previous.words }),
          ...meta,
        };
      },
      init: () => ({ dictating: false }),
    },
  });

function decorationsOf(state: EditorState) {
  const { dictating, landed, words } = dictationKey.getState(state) ?? {
    dictating: false,
  };
  const decorations: Decoration[] = [];
  if (dictating) {
    // The end of the last paragraph, where appended words begin: on a line
    // of their own when it has something in it, as they will land.
    const newLine = (state.doc.lastChild?.content.size ?? 0) > 0;
    const shown = words && (words.settled || words.interim) ? words : undefined;
    decorations.push(
      Decoration.widget(
        state.doc.content.size - 1,
        () => landingOf(shown, newLine && shown !== undefined),
        {
          ignoreSelection: true,
          key: `dictation-landing:${shown ? `${shown.settled}|${shown.interim}` : ""}`,
          side: 1,
        },
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

/** The words being heard, if the box shows them, then the mark where they land. */
function landingOf(
  words: { interim: string; settled: string } | undefined,
  newLine: boolean,
) {
  const landing = document.createElement("span");
  landing.className = newLine
    ? "dictation-words dictation-words-line"
    : "dictation-words";
  landing.contentEditable = "false";
  if (words) {
    landing.setAttribute("aria-live", "polite");
    landing.append(words.settled);
    if (words.interim) {
      const interim = document.createElement("span");
      interim.className = "dictation-interim";
      interim.textContent = `${words.settled ? " " : ""}${words.interim}`;
      landing.append(interim);
    }
  }
  const caret = document.createElement("span");
  caret.className = "dictation-landing";
  caret.setAttribute("aria-hidden", "true");
  landing.append(caret);
  return landing;
}
