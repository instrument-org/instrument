import { rpcClient } from "@/client/rpc/client";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";

/** How many names a search shows unless the caller asks for another number. */
const FILE_NAMES_SHOWN = 20;

/**
 * The files and folders whose names the typed words find, best first, among
 * the workspace's folder and the sidebar's folders. Asked with no words, as
 * a search box does when it opens, it finds nothing and has main ready the
 * names for the first letter.
 */
export function useFileNames({
  enabled = true,
  limit = FILE_NAMES_SHOWN,
  words,
}: {
  enabled?: boolean;
  limit?: number;
  words: string;
}) {
  const found = useQuery(
    rpcClient.files.findByName.queryOptions({
      input: enabled ? { limit, words: words.trim() } : skipToken,
      // The list keeps its rows while the next letter is looked for, rather
      // than emptying between the two answers.
      placeholderData: keepPreviousData,
    }),
  );
  return { entries: found.data ?? [], isPending: found.isPending };
}
