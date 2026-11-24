import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { firstFavoriteFolder } from "@/shared/favorite-places";
import { useQuery } from "@tanstack/react-query";

/**
 * Where Files opens when it is not opened at a folder of its own: the first
 * folder under Favorites in its sidebar, or the home folder while nothing is
 * there or before the sidebar's places have been read, so a press never
 * waits on them.
 */
export function useFilesStartHref() {
  const defaults = useQuery(
    rpcClient.workspace.computer.places.queryOptions({
      select: (places) => places.favorites,
    }),
  ).data;
  const favoriteChanges = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions({
      select: (preferences) => preferences.favoriteChanges,
    }),
  ).data;
  const first =
    defaults && favoriteChanges
      ? firstFavoriteFolder(defaults, favoriteChanges)
      : undefined;
  return folderHref(
    first === undefined || first === window.api.homeDir ? "~" : first,
  );
}
