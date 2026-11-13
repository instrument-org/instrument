import { groupNamesAtom } from "@/client/atoms/tab-groups";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { useSetAtom } from "jotai";

import { type TitleRename } from "./chat-title";
import { namedWith, type TabGroup } from "./tab-groups";

/**
 * Renaming a tab group in its row: the group takes a name of its own, the
 * same in every window, whether it has a chat or not, and a chat's title is
 * left as it is. The field opens on what the row shows (`shown`, the
 * group's own title, where it has no name), and a blank name takes the name
 * off, so the row goes back to its own title.
 */
export function useGroupRename(entry: TabGroup, shown: string): TitleRename {
  const setNames = useSetAtom(groupNamesAtom);
  return useInlineRename({
    allowsBlank: true,
    onSave: (name) => {
      setNames((names) => namedWith(names, entry.group, name));
      return Promise.resolve();
    },
    value: entry.name ?? shown,
  });
}
