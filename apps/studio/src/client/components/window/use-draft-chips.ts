import { type WindowTab } from "@/client/atoms/window";
import { type ChosenItem, type Draft, draftGroupOf } from "@/shared/drafts";

import {
  contextKeyOf,
  type ContextItem,
  draftContextItems,
  draftSuggestionOf,
} from "./context-items";
import { type BandTarget, useBandContext } from "./draft-band";

/**
 * A draft's chips (see `draftContextItems`) and what the window has in view
 * offered beside them (see `draftSuggestionOf`), which the caller opens in
 * the band when taken. The band and the draft's `context` are kept as one
 * (`useBandContext`), so whatever the band opens is written into the draft's
 * file. Taking a chip off closes its tab when it is one of the band's, and
 * takes its line out of `context` otherwise.
 */
export function useDraftChips({
  allTabs,
  band,
  closeTab,
  draft,
  finderOf,
  inView,
  onChange,
  open,
}: {
  allTabs: WindowTab[];
  /** The tabs of the draft's own band that stand as chips. */
  band: readonly WindowTab[];
  closeTab: (id: string) => void;
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  /** What the window has in view behind the draft, offered to it. */
  inView: undefined | WindowTab;
  onChange: (update: (draft: Draft) => Draft) => void;
  /** Opens a target in the draft's band, answering the tab's id. */
  open: (target: BandTarget) => string | undefined;
}) {
  const group = draftGroupOf(draft.id);
  useBandContext({ band, close: closeTab, draft, finderOf, onChange, open });
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
    if (item.kind === "tab" && item.tab.group === group) {
      closeTab(item.tab.id);
      return;
    }
    onChange((current) => {
      const left = (current.context ?? []).filter(
        (entry) => contextKeyOf(entry) !== item.key,
      );
      const { context: _was, ...rest } = current;
      return left.length > 0 ? { ...rest, context: left } : rest;
    });
  };
  return { items, leaveOut, suggestion };
}
