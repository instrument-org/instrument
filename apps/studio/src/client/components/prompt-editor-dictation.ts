import { type EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { dictationLead } from "./prompt-editor-model";

/**
 * What the editor shows while someone dictates: at the end of the words,
 * where theirs will land, the words being heard (when the box shows them)
 * and a mark at the spot.
 */
type DictationState = {
  dictating: boolean;
  words?: { interim: string; settled: string };
};

export const dictationKey = new PluginKey<DictationState>("dictation");

export const dictationPlugin = () =>
  new Plugin<DictationState>({
    key: dictationKey,
    props: {
      decorations: (state) => decorationsOf(state),
    },
    state: {
      apply: (tr, previous) => ({
        ...previous,
        ...(tr.getMeta(dictationKey) as Partial<DictationState> | undefined),
      }),
      init: () => ({ dictating: false }),
    },
  });

function decorationsOf(state: EditorState) {
  const { dictating, words } = dictationKey.getState(state) ?? {
    dictating: false,
  };
  if (!dictating) {
    return DecorationSet.empty;
  }
  // The end of the last line, where the words are appended: after a space
  // when the line has something in it and doesn't end on one, as they land.
  const lead = dictationLead(state.doc);
  const shown = words && (words.settled || words.interim) ? words : undefined;
  return DecorationSet.create(state.doc, [
    Decoration.widget(
      state.doc.content.size - 1,
      () => landingOf(shown, lead),
      {
        ignoreSelection: true,
        key: `dictation-landing:${lead}${shown ? `${shown.settled}|${shown.interim}` : ""}`,
        side: 1,
      },
    ),
  ]);
}

/** The words being heard, if the box shows them, then the mark where they land. */
function landingOf(
  words: { interim: string; settled: string } | undefined,
  lead: string,
) {
  const landing = document.createElement("span");
  landing.className = "dictation-words";
  landing.contentEditable = "false";
  if (words) {
    landing.setAttribute("aria-live", "polite");
    landing.append(lead + words.settled);
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
