import { getSearchQuery, type SearchQuery } from "@codemirror/search";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** What the editor's find shows, read off the editor's state after each update while its find is open. */
export interface CodeFind {
  /** The match the selection is on, one-based, or 0 when it is on none. */
  active: number;
  matches: number;
  query: SearchQuery;
  /** A file shown read only has no replace. */
  readOnly: boolean;
  /** Where each match starts, in the file, for marking them down the scroll. */
  starts: number[];
}

/**
 * Reads the editor's find off its state: the query, how many matches it has
 * in the file, and which of them the selection is on. Counted over the whole
 * file, since the readout says how many there are, not how many are in view.
 */
export function readCodeFind(state: EditorState): CodeFind {
  const query = getSearchQuery(state);
  const { from, to } = state.selection.main;
  let matches = 0;
  let active = 0;
  const starts: number[] = [];
  if (query.valid) {
    const cursor = query.getCursor(state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      matches += 1;
      starts.push(next.value.from);
      if (next.value.from === from && next.value.to === to) {
        active = matches;
      }
    }
  }
  return { active, matches, query, readOnly: state.readOnly, starts };
}

/**
 * Puts the selection on the first match at or after `from`, wrapping to the
 * file's first, and scrolls to it. This is what a changed query does, so a
 * query growing letter by letter stays on the match it was on; `findNext`
 * searches on from the selection's end and would step past it.
 */
export function selectMatchFrom(view: EditorView, from: number) {
  const query = getSearchQuery(view.state);
  if (!query.valid) {
    return;
  }
  const after = query.getCursor(view.state, from).next();
  const match = after.done ? query.getCursor(view.state).next() : after;
  if (match.done) {
    return;
  }
  view.dispatch({
    scrollIntoView: true,
    selection: EditorSelection.single(match.value.from, match.value.to),
    userEvent: "select.search",
  });
}
