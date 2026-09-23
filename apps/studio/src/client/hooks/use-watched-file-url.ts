import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

/**
 * The channel URL for a file on this computer that a viewer has open, at its
 * current version: the file is watched for as long as the viewer is mounted,
 * and each write gives it a new URL, so what is on screen follows the file
 * instead of the bytes it had when it was opened.
 *
 * Before the watch first answers, and while the file is not there, the URL
 * carries no version and is answered `no-store`.
 */
export function useWatchedFileUrl(hostPath: string | undefined) {
  const { data } = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({
      input: hostPath === undefined ? skipToken : { path: hostPath },
    }),
  );
  return hostPath === undefined
    ? undefined
    : getComputerFileUrl({
        hostPath,
        ...(data ? { version: data.modifiedAt } : {}),
      });
}
