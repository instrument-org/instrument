import { type WindowTab } from "@/client/atoms/window";
import { dismissedChipsAtom } from "@/client/drafts/dismissed-chips";
import { type ChosenItem, type Draft, draftGroupOf } from "@/shared/drafts";
import { useAtom } from "jotai";

import {
  contextKeyOf,
  type ContextItem,
  draftContextItems,
} from "./context-items";

/**
 * A draft's chips (see `draftContextItems`) and taking one off. A chip the
 * person chose takes its line out of the draft's `context`; a chip of what
 * is on screen is dismissed for this draft while the app runs.
 */
export function useDraftChips({
  allTabs,
  bandUp,
  draft,
  finderOf,
  inView,
  onChange,
}: {
  allTabs: WindowTab[];
  bandUp: undefined | WindowTab;
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  inView: undefined | WindowTab;
  onChange: (update: (draft: Draft) => Draft) => void;
}) {
  const [dismissed, setDismissed] = useAtom(dismissedChipsAtom);
  const items = draftContextItems({
    allTabs,
    bandUp,
    dismissed: dismissed[draft.id] ?? [],
    draft,
    finderOf,
    group: draftGroupOf(draft.id),
    inView,
  });
  const leaveOut = (item: ContextItem) => {
    if (
      (draft.context ?? []).some((entry) => contextKeyOf(entry) === item.key)
    ) {
      onChange((current) => {
        const left = (current.context ?? []).filter(
          (entry) => contextKeyOf(entry) !== item.key,
        );
        const { context: _was, ...rest } = current;
        return left.length > 0 ? { ...rest, context: left } : rest;
      });
      return;
    }
    setDismissed((current) => ({
      ...current,
      [draft.id]: [...(current[draft.id] ?? []), item.key],
    }));
  };
  return { items, leaveOut };
}
