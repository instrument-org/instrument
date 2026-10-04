import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { everyTabIdAtom } from "./window-tabs";

/** Where a tab's page picture is kept in the query cache. */
export const thumbnailKey = (key: string) => ["page-thumbnail", key] as const;

/**
 * Keeps the pages' pictures to the tabs the window holds: at startup, every
 * picture but those of the restored tabs is thrown away, and from then on a
 * picture goes with its tab, whether the tab was closed or its chat trashed.
 */
export function usePageThumbnailHousekeeping() {
  const queryClient = useQueryClient();
  const ids = useAtomValue(everyTabIdAtom);
  const previous = useRef<ReadonlySet<string>>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = ids;
    if (before === undefined) {
      // An empty window keeps everything: it may not be the window's tabs yet.
      if (ids.size > 0) {
        void safe(
          rpcClient.browser.thumbnails.keepOnly.call({ keys: [...ids] }),
        );
      }
      return;
    }
    const gone = [...before].filter((id) => !ids.has(id));
    if (gone.length === 0) {
      return;
    }
    for (const id of gone) {
      queryClient.removeQueries({ queryKey: thumbnailKey(id) });
    }
    void safe(rpcClient.browser.thumbnails.forget.call({ keys: gone }));
  }, [ids, queryClient]);
}
