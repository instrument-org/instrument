import { type WindowTab } from "@/client/atoms/window";
import {
  dismissedChipsAtom,
  linkDraftsAtom,
} from "@/client/drafts/dismissed-chips";
import { type ChosenItem, type Draft, draftGroupOf } from "@/shared/drafts";
import { useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";

import {
  contextKeyOf,
  type ContextItem,
  draftContextItems,
} from "./context-items";

/**
 * A draft's chips (see `draftContextItems`) and taking one off. A chip the
 * person chose takes its line out of the draft's `context`, and is dismissed
 * as well, so the screen does not name it again; a chip of what is on
 * screen is dismissed for this draft while the app runs.
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
  const linkDrafts = useAtomValue(linkDraftsAtom);
  const items = draftContextItems({
    allTabs,
    bandUp,
    dismissed: dismissed[draft.id] ?? [],
    draft,
    finderOf,
    group: draftGroupOf(draft.id),
    inView,
  });
  // A draft a link made goes with only what the person chose: each chip of
  // the screen is dismissed as it comes, the way a press on its ✕ would.
  const screenKeys = linkDrafts.has(draft.id)
    ? items
        .filter(
          (item) =>
            !(draft.context ?? []).some(
              (entry) => contextKeyOf(entry) === item.key,
            ),
        )
        .map((item) => item.key)
        .join("\n")
    : "";
  useEffect(() => {
    if (screenKeys === "") {
      return;
    }
    setDismissed((current) => ({
      ...current,
      [draft.id]: [...(current[draft.id] ?? []), ...screenKeys.split("\n")],
    }));
  }, [draft.id, screenKeys, setDismissed]);
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
    }
    setDismissed((current) => ({
      ...current,
      [draft.id]: [...(current[draft.id] ?? []), item.key],
    }));
  };
  return { items, leaveOut };
}
