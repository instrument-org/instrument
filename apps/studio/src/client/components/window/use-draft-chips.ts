import { type WindowTab } from "@/client/atoms/window";
import { type ChosenItem, type Draft, draftGroupOf } from "@/shared/drafts";

import {
  contextKeyOf,
  type ContextItem,
  draftContextItems,
  draftSuggestionOf,
} from "./context-items";

/**
 * A draft's chips (see `draftContextItems`), taking one off, and what the
 * window has in view offered beside them (see `draftSuggestionOf`), with
 * taking it, which writes it into the draft's `context` like anything the
 * person chose, so it stays until they take it off.
 */
export function useDraftChips({
  allTabs,
  band,
  draft,
  finderOf,
  inView,
  onChange,
}: {
  allTabs: WindowTab[];
  /** The tabs of the draft's own band, each a chip. */
  band: readonly WindowTab[];
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  /** What the window has in view behind the draft, offered to it. */
  inView: undefined | WindowTab;
  onChange: (update: (draft: Draft) => Draft) => void;
}) {
  const group = draftGroupOf(draft.id);
  const items = draftContextItems({ allTabs, band, draft, finderOf, group });
  const suggestion = draftSuggestionOf({
    allTabs,
    band,
    draft,
    finderOf,
    group,
    inView,
  });
  const leaveOut = (item: ContextItem) => {
    onChange((current) => {
      const left = (current.context ?? []).filter(
        (entry) => contextKeyOf(entry) !== item.key,
      );
      const { context: _was, ...rest } = current;
      return left.length > 0 ? { ...rest, context: left } : rest;
    });
  };
  const take = () => {
    if (!suggestion) {
      return;
    }
    onChange((current) => {
      const had = current.context ?? [];
      const keys = new Set(had.map(contextKeyOf));
      return {
        ...current,
        context: [
          ...had,
          ...suggestion.entries.filter(
            (entry) => !keys.has(contextKeyOf(entry)),
          ),
        ],
      };
    });
  };
  return { items, leaveOut, suggestion: suggestion?.item, take };
}
