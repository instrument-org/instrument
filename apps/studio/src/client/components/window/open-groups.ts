import { keptAtom } from "@/client/lib/kept-state";
import { rpcClient } from "@/client/rpc/client";
import { keptTabGroupsOf, TAB_GROUPS_KEY } from "@/shared/kept-state";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * The tab groups this window has open, in its own order, by their keys. Null
 * for a window that has kept none yet, which opens none of the chats there
 * are (`startTabGroupsFromZero`).
 */
export const windowTabGroupsAtom = keptAtom<null | readonly string[]>(
  "window",
  TAB_GROUPS_KEY,
  null,
  (value) => keptTabGroupsOf(value) ?? null,
);

/** The tab groups the other open windows have open, as main last said; undefined until it first answers. */
const groupsElsewhereAtom = atom<readonly string[] | undefined>(undefined);

/**
 * The tab groups the other open windows have open; undefined until main
 * first answers. The window's sidebar asks, which keeps `useIsGroupOpen` up.
 */
export function useTabGroupsElsewhere(): readonly string[] | undefined {
  const { data } = useQuery(
    rpcClient.window.live.tabGroupsElsewhere.experimental_liveOptions(),
  );
  const setElsewhere = useSetAtom(groupsElsewhereAtom);
  useEffect(() => {
    setElsewhere(data);
  }, [data, setElsewhere]);
  return data;
}

/** Whether an open window lists a group: this one, or another as main last said. */
export function useIsGroupOpen(): (group: string) => boolean {
  const here = useAtomValue(windowTabGroupsAtom);
  const elsewhere = useAtomValue(groupsElsewhereAtom);
  return (group) =>
    here?.includes(group) === true || elsewhere?.includes(group) === true;
}
