import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { rpcClient } from "@/client/rpc/client";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * The channel URL for a file on this computer that a viewer has open, at its
 * current version: the file is watched for as long as the viewer is mounted,
 * and each write gives it a new URL, so what is on screen follows the file
 * instead of the bytes it had when it was opened. A tab behind another keeps
 * the URL it last had, so its view loads nothing meanwhile and coming back to
 * it is when a write shows.
 *
 * Before the watch first answers, and while the file is not there, the URL
 * carries no version and is answered `no-store`.
 */
export function useWatchedFileUrl(hostPath: string | undefined) {
  const isActiveTab = useIsActiveTab();
  const { data } = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({
      input: hostPath === undefined ? skipToken : { path: hostPath },
    }),
  );
  const url =
    hostPath === undefined
      ? undefined
      : getComputerFileUrl({
          hostPath,
          ...(data ? { version: data.modifiedAt } : {}),
        });
  const [kept, setKept] = useState(url);
  if (isActiveTab && kept !== url) {
    setKept(url);
  }
  return isActiveTab ? url : kept;
}

/**
 * Whether the watch on a file a viewer has open says it is not there: gone
 * since it was opened (trashed, or a folder above it moved), or never there.
 * The same watch as `useWatchedFileUrl`, so asking both costs one.
 */
export function useWatchedFileGone(hostPath: string | undefined) {
  const { data } = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({
      input: hostPath === undefined ? skipToken : { path: hostPath },
    }),
  );
  return hostPath !== undefined && data === null;
}
