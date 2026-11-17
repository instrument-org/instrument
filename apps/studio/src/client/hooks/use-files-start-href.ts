import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { firstPinnedFolder } from "@/shared/sidebar-places";
import { useQuery } from "@tanstack/react-query";

/**
 * Where Files opens when it is not opened at a folder of its own: the first
 * folder under Pinned in its sidebar, or the home folder while nothing is
 * pinned or before the sidebar's places have been read, so a press never
 * waits on them.
 */
export function useFilesStartHref() {
  const defaults = useQuery(
    rpcClient.workspace.computer.places.queryOptions({
      select: (places) => places.pinned,
    }),
  ).data;
  const sidebarPlaces = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions({
      select: (preferences) => preferences.sidebarPlaces,
    }),
  ).data;
  const first =
    defaults && sidebarPlaces
      ? firstPinnedFolder(defaults, sidebarPlaces)
      : undefined;
  return folderHref(
    first === undefined || first === window.api.homeDir ? "~" : first,
  );
}
