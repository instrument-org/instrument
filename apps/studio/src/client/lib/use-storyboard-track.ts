import { rpcClient } from "@/client/rpc/client";
import { storyboardVtt } from "@/shared/video-storyboard";
import { skipToken, useQuery } from "@tanstack/react-query";

import { getComputerFileUrl } from "./computer-file-url";

/**
 * The `thumbnails` track for a video's timeline previews, as a `data:` URL
 * of its WebVTT, once `wanted` and the main process has made the video's
 * storyboard; nothing before then or for a video that gets none. The ask is
 * canceled when the player goes, which stops the run if nobody else waits.
 */
export function useStoryboardTrack(hostPath: string, wanted: boolean) {
  const { data } = useQuery(
    rpcClient.files.storyboard.queryOptions({
      input: wanted ? { path: hostPath } : skipToken,
      retry: false,
      // Asked afresh each time the player mounts, so a video written since
      // never shows the sheet of what it was.
      gcTime: 0,
    }),
  );
  if (!data) {
    return undefined;
  }
  const sheet = `${getComputerFileUrl({ hostPath, version: data.modifiedAt })}&storyboard`;
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(storyboardVtt(data, sheet))}`;
}
