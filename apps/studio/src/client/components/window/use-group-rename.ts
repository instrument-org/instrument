import { groupNamesAtom } from "@/client/atoms/tab-groups";
import { useInlineRename } from "@/client/hooks/use-inline-rename";
import { useSetAtom } from "jotai";

import { type TitleRename } from "./chat-title";
import { namedWith, type TabGroup } from "./tab-groups";
import { useChatRename } from "./use-chat-rename";

/**
 * Renaming a tab group in its row. A chat's group renames its chat, as the
 * chat's own rename does. A group whose chat has not started takes a name of
 * its own, the same in every window, which its chat starts under; the field
 * opens on what the row shows (`shown`), and a blank name takes the name off,
 * so the row goes back to its own title.
 */
export function useGroupRename(entry: TabGroup, shown: string): TitleRename {
  const chatRename = useChatRename(
    entry.kind === "chat" ? entry.chat : undefined,
  );
  const setNames = useSetAtom(groupNamesAtom);
  const draftRename = useInlineRename({
    allowsBlank: true,
    onSave: (name) => {
      setNames((names) => namedWith(names, entry.group, name));
      return Promise.resolve();
    },
    value: entry.kind === "draft" ? (entry.name ?? shown) : "",
  });
  return entry.kind === "chat" ? chatRename : draftRename;
}
